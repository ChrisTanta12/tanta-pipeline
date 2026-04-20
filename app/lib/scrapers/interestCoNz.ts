import * as cheerio from 'cheerio';
import type { BankId } from '../types';
import type { CardedRateCard } from '../types';

export const INTEREST_CO_NZ_URL = 'https://www.interest.co.nz/borrowing';
const USER_AGENT = 'TantaPipelineBot/1.0 (+internal use)';

// Maps the "alt" on the bank-logo image in the first column to our internal BankId.
const ALT_TO_BANKID: Record<string, BankId> = {
  ANZ: 'anz',
  ASB: 'asb',
  BNZ: 'bnz',
  Westpac: 'westpac',
  Kiwibank: 'kiwibank',
};

// Column index (0-based within <td>s) → rateCard term key.
// Row shape: 0=inst-name, 1=product, 2=Variable floating, 3=6mo, 4=1y, 5=2y, 6=3y, 7=4y, 8=5y
const TERM_COLUMNS: Array<{ index: number; key: string }> = [
  { index: 3, key: '6mo' },
  { index: 4, key: '1y' },
  { index: 5, key: '2y' },
  { index: 6, key: '3y' },
  { index: 7, key: '4y' },
  { index: 8, key: '5y' },
];

export type ScraperResult = {
  fetchedAt: string;
  banks: Partial<Record<BankId, CardedRateCard>>;
  warnings: string[];
};

function parseRate(raw: string): number | null {
  const t = raw.replace(/&nbsp;/g, ' ').trim();
  if (!t) return null;
  const m = t.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Parses a "18 months = 5.59" secondary row and returns the numeric value. */
function parseEighteenMonthRow(cells: string[]): number | null {
  for (const c of cells) {
    const m = c.match(/18\s*months?\s*=\s*(\d+(?:\.\d+)?)/i);
    if (m) return parseFloat(m[1]);
  }
  return null;
}

/**
 * Scrapes interest.co.nz/borrowing and returns carded rate cards for the five
 * banks we track. One request, no retries — run again tomorrow if it fails.
 */
export async function scrapeInterestCoNz(): Promise<ScraperResult> {
  const res = await fetch(INTEREST_CO_NZ_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    // Avoid Next.js's aggressive fetch caching on route handlers.
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`interest.co.nz returned ${res.status}`);
  const html = await res.text();
  return parseBorrowingHtml(html);
}

/** Pure parser split out for unit testing and offline runs. */
export function parseBorrowingHtml(html: string): ScraperResult {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const banks: Partial<Record<BankId, CardedRateCard>> = {};

  // The "Banks" section is the first <h2>Banks</h2> on the page, and its table
  // is the first .interest_financial_datatable in document order (other
  // sections like Building Societies, Credit Unions use the same class and
  // appear after). We assert the heading exists as a sanity check, then grab
  // the first table — they aren't direct siblings in the DOM tree.
  const banksHeading = $('h2').filter((_, el) => $(el).text().trim() === 'Banks').first();
  if (banksHeading.length === 0) {
    throw new Error('Could not locate "Banks" section heading on interest.co.nz');
  }
  const table = $('table.interest_financial_datatable').first();
  if (table.length === 0) {
    throw new Error('Could not locate Banks rate table');
  }

  let currentBank: BankId | null = null;
  let lastProductRow: { bankId: BankId; kind: 'lte80' | 'gt80' } | null = null;

  table.find('tbody tr').each((_, tr) => {
    const tds = $(tr).find('td').toArray();
    if (tds.length === 0) return;

    // Column 0: institution logo / name. If present, switch currentBank.
    const firstCell = $(tds[0]);
    const alt = firstCell.find('img').attr('alt')?.trim();
    const linkText = firstCell.find('a').text().trim();
    const bankKey = alt || linkText;
    if (bankKey && ALT_TO_BANKID[bankKey]) {
      currentBank = ALT_TO_BANKID[bankKey];
    } else if (bankKey) {
      // Known non-tracked bank (SBS, TSB, Co-op, etc.) — clear state.
      currentBank = null;
      lastProductRow = null;
    }

    if (!currentBank) return;

    const cells = tds.map((td) => $(td).text().replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
    const product = cells[1] ?? '';

    // Initialise the bank's card on first sight.
    if (!banks[currentBank]) {
      banks[currentBank] = {
        lte80: {},
        gt80: {},
        floating: null,
      };
    }
    const card = banks[currentBank]!;

    // Short "18 months = X.XX" attachment row — belongs to the most recent Standard/Special row.
    if (cells.length <= 3 && /18\s*months?/i.test(cells[2] ?? '')) {
      const v = parseEighteenMonthRow(cells);
      if (v !== null && lastProductRow && lastProductRow.bankId === currentBank) {
        card[lastProductRow.kind]['18mo'] = v;
      }
      return;
    }

    // Classify the product row. We only care about Standard and Special-LVR-<80%.
    // Seen product labels across the 5 banks:
    //   "Standard"
    //   "Special" (Kiwibank)
    //   "Special LVR under 80%" (ANZ)
    //   "Special LVR < 80%" (Westpac)
    let kind: 'lte80' | 'gt80' | null = null;
    if (/^Standard$/i.test(product)) kind = 'gt80';
    else if (/^Special\b/i.test(product) && !/classic|everyday|offset|greater|choice/i.test(product)) {
      kind = 'lte80';
    }

    if (!kind) {
      // Non-standard product (e.g. "Good Energy", "TotalMoney", "Offset", "Greater Choices") — skip.
      return;
    }

    // Full term row — must have at least 9 cells.
    if (cells.length < 9) {
      warnings.push(`${currentBank} ${product}: unexpected cell count ${cells.length}`);
      return;
    }

    for (const { index, key } of TERM_COLUMNS) {
      card[kind][key] = parseRate(cells[index]);
    }

    // Floating is only populated on the Standard row (column 2).
    if (kind === 'gt80') {
      const f = parseRate(cells[2]);
      if (f !== null) card.floating = f;
    }

    lastProductRow = { bankId: currentBank, kind };
  });

  // Every tracked bank should have a Standard row. Warn if missing.
  for (const id of Object.values(ALT_TO_BANKID)) {
    if (!banks[id]) warnings.push(`${id}: no rows parsed`);
    else if (Object.keys(banks[id]!.gt80).length === 0) warnings.push(`${id}: no Standard row parsed`);
  }

  return {
    fetchedAt: new Date().toISOString(),
    banks,
    warnings,
  };
}
