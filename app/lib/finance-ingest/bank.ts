/**
 * Bank statement parser. Reads ASB TransHist CSVs, detects which account they
 * are by looking at the "This Party Account" column suffix, then classifies
 * each line. Mirrors the rules in Tanta-Finance/inputs/categorize.mjs.
 */
import { parseCSV, parseFlexibleDate, isoDate } from './csv';
import type { BankAccount, BankLine } from './types';
import type { IncomeSource } from '@/app/lib/finance-types';

/* ---------- Account detection ---------- */

const ACCOUNT_SUFFIX_MAP: Record<string, BankAccount> = {
  '01': 'tanta_income',
  '02': 'payroll_8k',
  '03': 'chris_expenses',
  '04': 'ant_expenses',
  '25': 'opex_8_1k',
};

/** Extract the trailing -NN segment from `02-1257-0055853-01` → '01'. */
export function detectAccount(rows: string[][]): BankAccount {
  const headers = rows[0] ?? [];
  const tpIdx = headers.findIndex(h => h.trim().toLowerCase() === 'this party account');
  if (tpIdx === -1) return 'unknown';
  for (let i = 1; i < rows.length; i++) {
    const v = rows[i]?.[tpIdx];
    if (!v) continue;
    const m = v.match(/-(\d{2})$/);
    if (m) return ACCOUNT_SUFFIX_MAP[m[1]] ?? 'unknown';
  }
  // Fallback: Expenses CC has a different account-number shape (49-9914-...).
  for (let i = 1; i < rows.length; i++) {
    const v = rows[i]?.[tpIdx];
    if (v && v.startsWith('49-9914-')) return 'expenses_cc';
  }
  return 'unknown';
}

/* ---------- Income source mapping ---------- */

/** Best-effort mapping from a Tanta Income deposit payee → IncomeSource. */
function detectSource(payee: string, particulars: string): IncomeSource | null {
  const p = (payee + ' ' + particulars).toLowerCase();
  if (p.includes('kiwi adviser')) return 'KAN';
  if (p.includes('tanta limited') && p.includes('shl')) return 'SHL';
  if (p.includes('booster')) return 'Booster';
  if (p.includes('generate')) return 'Generate';
  if (p.includes('milford')) return 'Milford';
  if (p.includes('arthur') || p.includes('gallagh')) return 'AJG';
  if (p.includes('chubb')) return 'Chubb';
  if (p.includes('aia')) return 'AIA';
  if (p.includes('fid life') || p.includes('fidelity')) return 'FidLife';
  if (p.includes('lendy')) return 'Lendy';
  if (p.includes('nzfunds') || p.includes('nz funds')) return 'NZFunds';
  if (p.includes('pathfinder')) return 'Pathfinder';
  return null;
}

/* ---------- Classifiers ---------- */

function catTantaIncome(payee: string, particulars: string, amt: number): string {
  const p = (payee + ' ' + particulars).toLowerCase();
  if (amt > 0) {
    if (p.includes('kiwi adviser')) return 'INFLOW: KAN commission';
    if (p.includes('tanta limited') && p.includes('shl')) return 'INFLOW: SHL';
    if (p.includes('booster')) return 'INFLOW: Booster';
    if (p.includes('fid life') || p.includes('fidelity')) return 'INFLOW: Fidelity Life';
    if (p.includes('chubb')) return 'INFLOW: Chubb';
    if (p.includes('generate')) return 'INFLOW: Generate';
    if (p.includes('milford')) return 'INFLOW: Milford';
    if (p.includes('aia')) return 'INFLOW: AIA';
    if (p.includes('arthur') || p.includes('gallagh')) return 'INFLOW: AJG';
    if (p.includes('halo advisers')) return 'CAPITAL: Halo asset sale (NOT income)';
    if (p.includes('lendy')) return 'INFLOW: Lendy referral';
    if (p.includes('pathfinder')) return 'INFLOW: Pathfinder';
    if (p.includes('nzfunds') || p.includes('nz funds')) return 'INFLOW: NZ Funds';
    if (p.includes('cattell')) return 'CAPITAL: Cattell (Aaron) commission';
    if (p.includes('mr a p browne')) return 'CAPITAL: Anthony pass-through';
    if (p.includes('i.r.d') || p.includes('ird')) return 'INFLOW: IRD refund';
    return 'INFLOW: other (' + payee.trim().slice(0, 30) + ')';
  }
  // outflows from Tanta Income (-01) are the Profit First allocations
  if (p.includes('tanta tax')) return 'ALLOC: -> Tax (4%)';
  if (p.includes('tanta profit')) return 'ALLOC: -> Profit (2%)';
  if (p.includes('opex 8.1k') && p.includes('salar')) return 'ALLOC: -> Opex 8.1K (Salaries 45%)';
  if (p.includes('opex 8.1k') && p.includes('director')) return 'ALLOC: -> Opex 8.1K (Salaries 45%)';
  if (p.includes('opex 8.1k')) return 'ALLOC: -> Opex 8.1K (Opex 49%)';
  if (p.includes('payroll')) return 'TRANSFER: -> Payroll 8K';
  if (p.includes('expenses cc')) return 'TRANSFER: -> CC top-up';
  return 'OUT: ' + payee.trim().slice(0, 30);
}

function catOpex(payee: string, particulars: string, amt: number): string {
  const p = (payee + ' ' + particulars).toLowerCase();
  if (amt > 0) {
    if (p.includes('tanta income')) return 'INFLOW: from Tanta Income (allocation)';
    if (p.includes('mr a p browne')) return 'CAPITAL: contractor / one-off';
    return 'INFLOW: other';
  }
  if (p.includes('chris personal')) return 'DRAW: Chris loan-repay';
  if (p.includes('ant personal')) return 'DRAW: Anthony loan-repay';
  // Top-ups to Chris/Anthony's business-expense float cards are opex, not
  // drawings. Both flow into the DirectorExpenseFloat bucket (the parens get
  // stripped when compose.ts extracts the category key).
  if (p.includes('chris expenses')) return 'OPEX: DirectorExpenseFloat (Chris)';
  if (p.includes('ant expenses')) return 'OPEX: DirectorExpenseFloat (Anthony)';
  if (p.includes('payroll')) return 'TRANSFER: -> Payroll 8K';
  if (p.includes('expenses cc')) return 'TRANSFER: -> CC top-up';
  if (p.includes('new hire')) return 'TRANSFER: -> Strategic reserve';
  if (p.includes('gocardless') && p.includes('trail')) return 'OPEX: Trail (CRM)';
  if (p.includes('gocardless')) return 'OPEX: GoCardless (other)';
  if (p.includes('inland revenue')) return 'OPEX: GST / IRD';
  if (p.includes('bean rock')) return 'OPEX: Rent';
  if (p.includes('monument') || p.includes('gallagher')) return 'OPEX: PI insurance';
  if (p.includes('val book') || p.includes('bookkeeping')) return 'OPEX: Bookkeeping';
  if (p.includes('marissa stevens') || p.includes('bo li')) return 'OPEX: Bo Li interest';
  if (p.includes('stephen mead') || p.includes('chase vesey')) return 'OPEX: Networking / events';
  if (p.includes('afford')) return 'OPEX: AffordX';
  if (p.includes('genesis')) return 'OPEX: Utilities';
  if (p.includes('one nz')) return 'OPEX: Telco';
  if (p.includes('the mortgage man')) return 'CAPITAL: Mortgage Man wash-up';
  if (p.includes('collett') || p.includes('legal')) return 'OPEX: Legal';
  return 'OPEX: other (' + payee.trim().slice(0, 30) + ')';
}

function catExpensesCc(payee: string, particulars: string, amt: number): string {
  const p = (payee + ' ' + particulars).toLowerCase();
  if (amt > 0) return 'INFLOW: top-up';
  if (p.includes('lean marketing')) return 'OPEX: Marketing — Lean Marketing';
  if (p.includes('vistaprint')) return 'OPEX: Marketing — Vistaprint';
  if (p.includes('seek')) return 'OPEX: Hiring — Seek';
  if (p.includes('google workspace')) return 'OPEX: SaaS — Google Workspace';
  if (p.includes('claude.ai') || p.includes('anthropic')) return 'OPEX: SaaS — Claude.ai';
  if (p.includes('openai')) return 'OPEX: SaaS — OpenAI';
  if (p.includes('canva')) return 'OPEX: SaaS — Canva';
  if (p.includes('notion')) return 'OPEX: SaaS — Notion';
  if (p.includes('fathom')) return 'OPEX: SaaS — Fathom';
  if (p.includes('microsoft')) return 'OPEX: SaaS — Microsoft';
  if (p.includes('brevo') || p.includes('sendinblue')) return 'OPEX: SaaS — Brevo';
  if (p.includes('typeform')) return 'OPEX: SaaS — Typeform';
  if (p.includes('scoreapp')) return 'OPEX: SaaS — ScoreApp';
  if (p.includes('vimeo')) return 'OPEX: SaaS — Vimeo';
  if (p.includes('block 81')) return 'OPEX: SaaS — Block81';
  if (p.includes('briskine')) return 'OPEX: SaaS — Briskine';
  if (p.includes('wispr')) return 'OPEX: SaaS — Wispr';
  if (p.includes('spotify')) return 'OPEX: SaaS — Spotify';
  if (p.includes('audible')) return 'OPEX: SaaS — Audible';
  if (p.includes('nz transport')) return 'OPEX: Vehicle';
  if (p.includes('tyre') || p.includes('smz')) return 'OPEX: Vehicle';
  if (p.includes('subway') || p.includes('shahrzad') || p.includes('takimi') || p.includes('coffix') || p.includes('tank') || p.includes('bazzas') || p.includes('semplice')) return 'OPEX: Meals & coffee';
  if (p.includes('samsung')) return 'OPEX: Equipment';
  if (p.includes('account fee')) return 'OPEX: Bank fees';
  if (p.includes('post')) return 'OPEX: Postage';
  return 'OPEX: other (' + payee.trim().slice(0, 30) + ')';
}

const CAT_BY_ACCOUNT: Record<BankAccount, (payee: string, particulars: string, amt: number) => string> = {
  tanta_income: catTantaIncome,
  opex_8_1k: catOpex,
  expenses_cc: catExpensesCc,
  payroll_8k: catOpex,    // similar shape — drawings/transfers
  chris_expenses: catOpex,
  ant_expenses: catOpex,
  unknown: catOpex,
};

/* ---------- Top-level parser ---------- */

/**
 * Parse a single bank-statement CSV. Returns the detected account + classified
 * lines. Date filtering happens later in compose.ts so callers can show line
 * counts that include out-of-window context.
 */
export function parseBankCsv(text: string): { account: BankAccount; lines: BankLine[] } {
  const rows = parseCSV(text);
  if (rows.length < 2) return { account: 'unknown', lines: [] };
  const account = detectAccount(rows);
  const classifier = CAT_BY_ACCOUNT[account];

  const headers = rows[0].map(h => h.trim().toLowerCase());
  const dateIdx = headers.indexOf('date');
  const amtIdx = headers.indexOf('amount');
  const payeeIdx = headers.indexOf('payee');
  const particularsIdx = headers.indexOf('particulars');

  const lines: BankLine[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 4) continue;
    const d = parseFlexibleDate(row[dateIdx]);
    if (!d) continue;
    const amt = parseFloat((row[amtIdx] ?? '').replace(/,/g, ''));
    if (!Number.isFinite(amt)) continue;
    const payee = row[payeeIdx] ?? '';
    const particulars = row[particularsIdx] ?? '';
    const rawCategory = classifier(payee, particulars, amt);
    const knownSource = account === 'tanta_income' && amt > 0
      ? detectSource(payee, particulars)
      : null;
    lines.push({
      date: isoDate(d),
      amount: amt,
      payee: payee.trim(),
      particulars: particulars.trim(),
      rawCategory,
      knownSource,
      account,
    });
  }
  return { account, lines };
}
