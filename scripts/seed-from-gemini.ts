/**
 * One-off: merges a paste of Gemini's "Big 5" rate extraction JSON into
 * the banks table so the dashboard is immediately accurate while the
 * Apps Script ingest is being set up.
 *
 * Usage:
 *   npm run seed:gemini
 *
 * When Gemini gives you an updated dump, replace the SOURCE constant
 * with the new paste and re-run. rateCard is fully replaced per bank;
 * manual turnaround overrides (source: 'manual') are preserved by the
 * shim in mergeBankData. All rates are treated as LVR ≤80% "Special"
 * values because that's what the prompt extracts.
 */
import { mergeBankData } from '../app/lib/db';
import type { BankData, BankId, RateRow } from '../app/lib/types';

interface GeminiRates {
  floating: string;
  '6_month': string;
  '1_year': string;
  '18_month': string;
  '2_year': string;
  '3_year': string;
  '4_year': string;
  '5_year': string;
}

interface GeminiBank {
  effective_date: string;
  source_date: string;
  rates: GeminiRates;
  cashback: string;
  /** Headline shown on the bank card next to "Cash Contribution" before
   *  the user expands the details. Keep short. */
  cashback_headline: string;
  /** Optional TAT per category (days). If omitted, existing turnaround
   *  data in the row is preserved (we deliberately don't pull TAT for
   *  ANZ / Kiwibank — those are gated behind portal logins and updated
   *  via a separate internal workflow). Manual overrides
   *  (source='manual') always win over seed writes. */
  turnaround?: Record<string, number>;
}

// Paste the latest Gemini Big-5 JSON here:
const SOURCE: Record<string, GeminiBank> = {
  ANZ: {
    effective_date: '2026-04-23',
    rates: {
      floating: '5.29%',
      '6_month': '4.49%',
      '1_year': '4.59%',
      '18_month': '4.79%',
      '2_year': '4.99%',
      '3_year': '5.39%',
      '4_year': '5.65%',
      '5_year': '5.79%',
    },
    cashback:
      'Up to 0.9% for new lending $200k-$1.49m (max $13,500); Up to 1% for $1.5m-$3.0m (max $30,000); $5,000 for First Home Buyers (min $200k lending).',
    cashback_headline: '0.9%',
    source_date: '2026-04-21',
    // Turnaround omitted — ANZ is portal-only, managed via internal workflow
  },
  ASB: {
    effective_date: '2026-04-20',
    rates: {
      floating: '5.09%',
      '6_month': '4.49%',
      '1_year': '4.49%',
      '18_month': '4.69%',
      '2_year': '4.89%',
      '3_year': '5.29%',
      '4_year': '5.49%',
      '5_year': '5.65%',
    },
    cashback:
      'Up to 0.90% (max $20,000) for owner-occupied or investor/mixed lending ≥$200k; $5,000 for First Home Buyers (min $200k lending).',
    cashback_headline: '0.9%',
    source_date: '2026-04-20',
    turnaround: { 'Retail': 5 }, // 5 business days for new lending + pre-approvals
  },
  BNZ: {
    effective_date: '2026-04-21',
    rates: {
      floating: '5.84%',
      '6_month': '4.49%',
      '1_year': '4.49%',
      '18_month': '4.79%',
      '2_year': '4.89%',
      '3_year': '5.29%',
      '4_year': '5.49%',
      '5_year': '5.69%',
    },
    cashback:
      'Up to 0.9% for new loans (min $200k); 1% for construction/turnkey; Max $20,000; $5,000 for First Home Buyers (min $250k lending).',
    cashback_headline: '0.9%',
    source_date: '2026-04-21',
    turnaround: { 'New Applications': 6, 'Restructures': 5 },
  },
  Westpac: {
    effective_date: '2026-04-20',
    rates: {
      floating: '5.59%',
      '6_month': '4.49%',
      '1_year': '4.59%',
      '18_month': '4.85%',
      '2_year': '4.99%',
      '3_year': '5.29%',
      '4_year': '5.39%',
      '5_year': '5.59%',
    },
    cashback:
      '0.9% of new lending amount (min $100k, max $20,000); Minimum $5,000 for First Home Buyers (min $250k lending).',
    cashback_headline: '0.9%',
    source_date: '2026-04-17',
    turnaround: { 'Retail': 5, 'Business': 10 },
  },
  Kiwibank: {
    effective_date: '2026-04-21',
    rates: {
      floating: '5.65%',
      '6_month': '4.45%',
      '1_year': '4.45%',
      '18_month': 'Not offered', // Kiwibank doesn't offer an 18-month term
      '2_year': '5.09%',
      '3_year': '5.45%',
      '4_year': '5.79%',
      '5_year': '5.89%',
    },
    cashback:
      '0.85% for refinance, 0.9% otherwise (max $20,000); Minimum $5,000 for First Home Buyers (min $250k lending).',
    cashback_headline: '0.9% · 0.85% refi',
    source_date: '2026-04-21',
    // Turnaround omitted — Kiwibank TAT comes from the Hub portal, managed via internal workflow
  },
};

const BANK_NAME_TO_ID: Record<string, BankId> = {
  ANZ: 'anz',
  ASB: 'asb',
  BNZ: 'bnz',
  Westpac: 'westpac',
  Kiwibank: 'kiwibank',
};

const TERM_KEY_MAP: Array<[keyof GeminiRates, string]> = [
  ['6_month', '6mo'],
  ['1_year', '1y'],
  ['18_month', '18mo'],
  ['2_year', '2y'],
  ['3_year', '3y'],
  ['4_year', '4y'],
  ['5_year', '5y'],
  ['floating', 'floating'],
];

function parseRate(s: string | undefined): number | null {
  if (!s) return null;
  if (/not specified|n\/?a|—|unknown/i.test(s)) return null;
  const m = s.match(/(\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : null;
}

async function main() {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL not set — is .env.local loaded?');
  }

  const today = new Date().toISOString().slice(0, 10);

  for (const [name, bank] of Object.entries(SOURCE)) {
    const bankId = BANK_NAME_TO_ID[name];
    if (!bankId) {
      console.warn(`unknown bank ${name}, skipping`);
      continue;
    }

    const rateCard: Record<string, RateRow> = {};
    for (const [geminiKey, canonicalKey] of TERM_KEY_MAP) {
      const rate = parseRate(bank.rates[geminiKey]);
      rateCard[canonicalKey] = { lte80: rate, gt80: null };
    }

    const patch: Partial<BankData> = {
      rateCard,
      cashback: { summary: bank.cashback, headline: bank.cashback_headline },
      fees: { rateCardEffectiveDate: bank.effective_date },
      lastSourceEmail: {
        id: `manual-seed-${today}`,
        subject: `Manual Gemini extraction (source ${bank.source_date})`,
        date: bank.source_date,
      },
    };

    if (bank.turnaround) {
      const now = new Date().toISOString();
      const tatMap: Record<string, { days: number; source: 'auto'; updatedAt: string }> = {};
      for (const [key, days] of Object.entries(bank.turnaround)) {
        tatMap[key] = { days, source: 'auto', updatedAt: now };
      }
      // mergeBankData's shim merges per-key and preserves source='manual' entries
      (patch as Partial<BankData> & { turnaround?: unknown }).turnaround = tatMap;
    }

    const populated = Object.values(rateCard).filter(r => r.lte80 !== null).length;
    console.log(
      `→ ${bankId}: ${populated}/${TERM_KEY_MAP.length} rates, effectiveDate=${bank.effective_date}`,
    );
    await mergeBankData(bankId, patch);
    console.log(`  ✓ merged`);
  }

  console.log('\nseed complete — reload /lenders to see fresh data');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
