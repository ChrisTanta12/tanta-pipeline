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
}

// Paste the latest Gemini Big-5 JSON here:
const SOURCE: Record<string, GeminiBank> = {
  ANZ: {
    effective_date: '2026-04-15',
    rates: {
      floating: '5.54%',
      '6_month': '4.49%',
      '1_year': '4.69%',
      '18_month': '4.99%',
      '2_year': '5.29%',
      '3_year': '5.49%',
      '4_year': '6.19%',
      '5_year': '6.29%',
    },
    cashback:
      'Up to 0.9% for new lending $200k-$1.49m (max $13,500); Up to 1% for $1.5m-$3.0m (max $30,000); $5,000 for First Home Buyers (min $200k lending).',
    cashback_headline: '0.9%',
    source_date: '2026-04-16',
  },
  ASB: {
    effective_date: '2026-04-20',
    rates: {
      floating: '5.19%',
      '6_month': '4.49%',
      '1_year': '4.49%',
      '18_month': '4.69%',
      '2_year': '4.89%',
      '3_year': '5.29%',
      '4_year': '5.49%',
      '5_year': '5.65%',
    },
    cashback:
      'Up to 0.90% for new securities (max $20,000); $5,000 for First Home Buyers (min $200k lending).',
    cashback_headline: '0.9%',
    source_date: '2026-04-20',
  },
  BNZ: {
    effective_date: '2026-04-21',
    rates: {
      floating: '5.84%',
      '6_month': '4.49%',
      '1_year': '4.59%',
      '18_month': '4.79%',
      '2_year': '4.89%',
      '3_year': '5.29%',
      '4_year': '5.59%',
      '5_year': '5.79%',
    },
    cashback:
      '0.9% for new loans (min $200k); 1% for construction; Max $20k; $5k for First Home Buyers.',
    cashback_headline: '0.9%',
    source_date: '2026-04-21',
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
      '0.9% of new lending (min $100k, max $20,000); Minimum $5,000 for First Home Buyers (min $250k lending).',
    cashback_headline: '0.9%',
    source_date: '2026-04-17',
  },
  Kiwibank: {
    effective_date: '2026-04-21',
    rates: {
      floating: '5.65%',
      '6_month': '4.45%',
      '1_year': '4.65%',
      '18_month': 'Not offered', // Kiwibank doesn't offer an 18-month term
      '2_year': '5.29%',
      '3_year': '5.55%',
      '4_year': '5.89%',
      '5_year': '5.99%',
    },
    cashback:
      '0.85% for refinance, 0.9% otherwise (max $20k); First Home Buyers eligible for min $5,000 (min $250k lending).',
    cashback_headline: '0.9% · 0.85% refi',
    source_date: '2026-04-21',
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
