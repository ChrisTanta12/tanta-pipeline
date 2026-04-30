import * as cheerio from 'cheerio';

export const SWAP_RATES_URL = 'https://www.interest.co.nz/charts/interest-rates/swap-rates';
const USER_AGENT = 'TantaPipelineBot/1.0 (+internal use)';

export type SwapRateTerm = '1y' | '2y' | '3y' | '4y' | '5y' | '7y' | '10y';

export type SwapRateSnapshot = {
  fetchedAt: string;       // when we scraped
  source: string;          // URL we scraped from
  observationDate: string | null; // the "as at" date shown on the page (ISO yyyy-mm-dd if parseable)
  rates: Record<string, number>;
  warnings: string[];
};

const TERM_HEADERS: Array<{ regex: RegExp; key: SwapRateTerm }> = [
  { regex: /^1\s*(yr|year)s?$/i, key: '1y' },
  { regex: /^2\s*(yr|year)s?$/i, key: '2y' },
  { regex: /^3\s*(yr|year)s?$/i, key: '3y' },
  { regex: /^4\s*(yr|year)s?$/i, key: '4y' },
  { regex: /^5\s*(yr|year)s?$/i, key: '5y' },
  { regex: /^7\s*(yr|year)s?$/i, key: '7y' },
  { regex: /^10\s*(yr|year)s?$/i, key: '10y' },
];

function headerToTerm(label: string): SwapRateTerm | null {
  const t = label.replace(/&nbsp;/g, ' ').trim();
  for (const m of TERM_HEADERS) if (m.regex.test(t)) return m.key;
  return null;
}

function parseRate(raw: string): number | null {
  const t = raw.replace(/&nbsp;/g, ' ').trim();
  if (!t || t === '-' || t === '–') return null;
  const m = t.match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Tries to parse "Wednesday, 29 April 2026" / "29 Apr 2026" / "29/04/2026" → ISO date.
 */
function parseObservationDate(s: string): string | null {
  const t = s.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  // ISO already
  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // dd/mm/yyyy
  const dmy = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    return `${dmy[3]}-${mm}-${dd}`;
  }
  // dd Month yyyy
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const dmYY = t.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (dmYY) {
    const dd = dmYY[1].padStart(2, '0');
    const monKey = dmYY[2].slice(0, 3).toLowerCase();
    const mm = months[monKey];
    if (mm) return `${dmYY[3]}-${mm}-${dd}`;
  }
  return null;
}

/**
 * Scrapes interest.co.nz/charts/interest-rates/swap-rates and returns the
 * most recent observation. The page renders a sortable HTML table whose
 * header row contains "Date", "1yr", "2yrs", etc., and the latest row is
 * either at the top or the bottom depending on sort order — we pick the
 * row whose date parses to the most recent value.
 *
 * One request, no retries — if it fails, the cron runs again tomorrow.
 */
export async function scrapeSwapRates(): Promise<SwapRateSnapshot> {
  const res = await fetch(SWAP_RATES_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`interest.co.nz swap-rates returned ${res.status}`);
  const html = await res.text();
  return parseSwapRatesHtml(html);
}

/** Pure parser split out for offline tests. */
export function parseSwapRatesHtml(html: string): SwapRateSnapshot {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const fetchedAt = new Date().toISOString();

  // Find the first table that has a header row containing "Date" + at least one yr-term column.
  let chosenTable: any = null;
  let headerMap: Array<SwapRateTerm | null> = [];
  let dateColIdx = -1;

  $('table').each((_, tableEl) => {
    if (chosenTable) return;
    const $t = $(tableEl);
    let headerCells = $t.find('thead tr').first().find('th, td').toArray();
    if (headerCells.length === 0) {
      headerCells = $t.find('tr').first().find('th, td').toArray();
    }
    if (headerCells.length === 0) return;
    const labels = headerCells.map((c) => $(c).text().trim());
    const dIdx = labels.findIndex((l) => /^date$/i.test(l));
    const map: Array<SwapRateTerm | null> = labels.map((l) => headerToTerm(l));
    const termCount = map.filter((m) => m !== null).length;
    if (dIdx >= 0 && termCount >= 3) {
      chosenTable = tableEl;
      headerMap = map;
      dateColIdx = dIdx;
    }
  });

  if (!chosenTable || dateColIdx < 0) {
    throw new Error('Could not locate swap rates table on interest.co.nz/charts/interest-rates/swap-rates');
  }

  // Collect all data rows with parsed dates, then pick the most recent.
  type Row = { date: string; rates: Record<string, number> };
  const rows: Row[] = [];

  const collectRow = (cells: any[]): Row | null => {
    if (cells.length < 2) return null;
    const dateRaw = $(cells[dateColIdx]).text();
    const iso = parseObservationDate(dateRaw);
    if (!iso) return null;
    const rates: Record<string, number> = {};
    for (let i = 0; i < cells.length; i++) {
      const term = headerMap[i];
      if (!term) continue;
      const v = parseRate($(cells[i]).text());
      if (v != null) rates[term] = v;
    }
    if (Object.keys(rates).length === 0) return null;
    return { date: iso, rates };
  };

  $(chosenTable).find('tbody tr').each((_: number, tr: any) => {
    const cells = $(tr).find('td, th').toArray();
    const row = collectRow(cells);
    if (row) rows.push(row);
  });

  if (rows.length === 0) {
    // Tables sometimes lack a tbody wrapper — retry with all rows minus header.
    const allTrs = $(chosenTable).find('tr').toArray();
    for (let i = 1; i < allTrs.length; i++) {
      const cells = $(allTrs[i]).find('td, th').toArray();
      const row = collectRow(cells);
      if (row) rows.push(row);
    }
  }

  if (rows.length === 0) {
    throw new Error('Swap rates table found but no parseable rows');
  }

  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  const latest = rows[0];

  return {
    fetchedAt,
    source: SWAP_RATES_URL,
    observationDate: latest.date,
    rates: latest.rates,
    warnings,
  };
}
