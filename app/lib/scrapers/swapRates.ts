import * as XLSX from 'xlsx';

/**
 * RBNZ "B2 — Wholesale interest rates (daily close)" XLSX. The official
 * source for NZ swap rates. We pull the latest row each day and store it
 * in the swap_rates table.
 *
 * RBNZ updates this file the next business day after market close.
 */
export const RBNZ_B2_URL =
  'https://www.rbnz.govt.nz/-/media/project/sites/rbnz/files/statistics/series/b/b2/hb2-daily-close.xlsx';
const USER_AGENT = 'Mozilla/5.0 TantaPipelineBot/1.0 (+internal use)';

export type SwapRateTerm = '1y' | '2y' | '3y' | '4y' | '5y' | '7y' | '10y';

export type SwapRateSnapshot = {
  fetchedAt: string;
  source: string;
  observationDate: string | null;   // ISO yyyy-mm-dd
  rates: Record<string, number>;
  warnings: string[];
};

// Series IDs for swap rates close. Stable across RBNZ revisions.
const SERIES_TO_TERM: Record<string, SwapRateTerm> = {
  'INM.DS01.NZZC': '1y',
  'INM.DS02.NZZC': '2y',
  'INM.DS03.NZZC': '3y',
  'INM.DS04.NZZC': '4y',
  'INM.DS05.NZZC': '5y',
  'INM.DS07.NZZC': '7y',
  'INM.DS10.NZZC': '10y',
};

const SERIES_ID_ROW = 4;          // 0-indexed row containing "Series Id" header + series codes
const FIRST_DATA_ROW = 5;         // first row with actual values

function excelSerialToISODate(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  // Excel serial 25569 = 1970-01-01 (compensates for Lotus's spurious Feb 29 1900).
  // Exact for dates after 1 March 1900, which covers all RBNZ data (1985+).
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const date = new Date(ms);
  if (isNaN(date.getTime())) return null;
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Downloads the RBNZ daily close workbook and extracts the most recent
 * observation row. One request, no retries.
 */
export async function scrapeSwapRates(): Promise<SwapRateSnapshot> {
  const res = await fetch(RBNZ_B2_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`RBNZ B2 returned ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return parseRbnzB2Workbook(buf);
}

/** Pure parser split out for offline tests / CLI runs. */
export function parseRbnzB2Workbook(buf: Buffer): SwapRateSnapshot {
  const fetchedAt = new Date().toISOString();
  const warnings: string[] = [];

  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase() === 'data') ?? wb.SheetNames[0];
  if (!sheetName) throw new Error('RBNZ B2 workbook has no sheets');
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true });
  if (rows.length <= FIRST_DATA_ROW) {
    throw new Error('RBNZ B2 workbook has no data rows');
  }

  const seriesIdRow = rows[SERIES_ID_ROW];
  if (!Array.isArray(seriesIdRow) || seriesIdRow.length < 10) {
    throw new Error('RBNZ B2 series-id header row missing or too short');
  }

  // Build column-index → term map by matching series IDs.
  const colToTerm: Record<number, SwapRateTerm> = {};
  for (let i = 0; i < seriesIdRow.length; i++) {
    const sid = String(seriesIdRow[i] ?? '').trim();
    if (sid in SERIES_TO_TERM) colToTerm[i] = SERIES_TO_TERM[sid];
  }
  const matchedTerms = Object.values(colToTerm);
  if (matchedTerms.length === 0) {
    throw new Error('No swap rate series IDs found in RBNZ B2 workbook');
  }
  if (matchedTerms.length < Object.keys(SERIES_TO_TERM).length) {
    const missing = Object.values(SERIES_TO_TERM).filter((t) => !matchedTerms.includes(t));
    warnings.push(`Missing terms: ${missing.join(', ')}`);
  }

  // Walk backwards from the end to find the most recent row that has any
  // non-null swap rate value — RBNZ sometimes pads the bottom with empty
  // rows on weekends/holidays, and some terms might be null on a given day.
  let observationDate: string | null = null;
  const rates: Record<string, number> = {};

  for (let r = rows.length - 1; r >= FIRST_DATA_ROW; r--) {
    const row = rows[r];
    if (!Array.isArray(row) || row.length === 0) continue;
    const dateCell = row[0];
    if (typeof dateCell !== 'number') continue;
    const iso = excelSerialToISODate(dateCell);
    if (!iso) continue;

    let anyRate = false;
    const rowRates: Record<string, number> = {};
    for (const colIdxStr of Object.keys(colToTerm)) {
      const colIdx = Number(colIdxStr);
      const v = row[colIdx];
      if (typeof v === 'number' && Number.isFinite(v)) {
        rowRates[colToTerm[colIdx]] = v;
        anyRate = true;
      }
    }
    if (anyRate) {
      observationDate = iso;
      Object.assign(rates, rowRates);
      break;
    }
  }

  if (!observationDate) {
    throw new Error('No row with swap rate values found in RBNZ B2 workbook');
  }

  return {
    fetchedAt,
    source: RBNZ_B2_URL,
    observationDate,
    rates,
    warnings,
  };
}
