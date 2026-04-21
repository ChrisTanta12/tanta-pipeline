export type BankId = 'anz' | 'asb' | 'bnz' | 'westpac' | 'kiwibank';

export type RateValue = number | string | null;

export interface RateRow {
  lte80: RateValue;
  gt80: RateValue;
}

/**
 * A single turnaround-time entry keyed by a bank-defined display label.
 * Different banks expose different TAT categories (e.g. ANZ has
 * "Priority Retail"/"Other Retail"/"Reassessment"; ASB has "New Home
 * Lending Applications"/"Variations"/"Top-ups") so we don't enforce a
 * fixed schema — just a flexible map.
 *
 * `source` distinguishes parser/vision-extracted data from admin-entered
 * overrides. Manual entries always win over auto ones on merge (see
 * `mergeBankData` in db.ts) until an admin clears them.
 */
export interface TurnaroundEntry {
  days: number | string;        // "4" or 4 or "up to 7"
  updatedAt: string;             // ISO timestamp
  source: 'auto' | 'manual';     // auto = parser/vision; manual = admin-entered
}
export type TurnaroundMap = Record<string, TurnaroundEntry>;

/**
 * Legacy turnaround shape still produced by existing parsers
 * (app/lib/parsers/*.ts) and the vision prompt in anthropic.ts.
 * The db-write shim in mergeBankData converts this into a TurnaroundMap
 * with "Retail" / "Business" keys before persisting.
 */
export interface LegacyTurnaround {
  retail?: number | string;
  business?: number | string;
}

export interface BankData {
  name?: string;
  resourcesFolderUrl?: string;
  rateCard?: Record<string, RateRow>;
  trafficLights?: {
    lte80?: { existing: string; new: string };
    '80_90'?: { existing: string; new: string };
  };
  // Persisted shape is TurnaroundMap (see mergeBankData shim in db.ts). The
  // LegacyTurnaround arm exists only so existing parsers (app/lib/parsers/*.ts)
  // and the vision prompt in anthropic.ts — which still write the old
  // { retail, business } shape — continue to typecheck. Read-paths should
  // treat this as TurnaroundMap because the shim normalises on every write.
  turnaround?: TurnaroundMap | LegacyTurnaround;
  cashback?: Record<string, number | string | null>;
  lep?: Record<string, number | string | null>;
  fees?: Record<string, string | number | null>;
  lowEquityUmi?: Record<string, string>;
  serviceRate?: number;
  bdm?: { name: string; phone: string; email: string; role?: string };
  bdm2?: { name: string; phone: string; email: string; role?: string };
  commission?: Record<string, number | string | null | Record<string, unknown>>;
  boarderIncome?: { lte80: string; gt80: string };
  productFeatures?: Record<string, string>;
  lastSourceEmail?: {
    id: string;
    subject: string;
    date: string;
  };
}

/**
 * Rate card scraped from interest.co.nz/borrowing. Parallel to BankData.rateCard
 * but kept separate so broker-special data (BankData) is never overwritten.
 * Mirrors RateRow keys: lte80 from the "Special LVR under 80%" row,
 * gt80 from the "Standard" row. `floating` is the "Variable floating" column
 * from the Standard row. Values are stringified percentages as numbers
 * (e.g. 4.49) or null when the cell was blank on the source page.
 */
export interface CardedRateCard {
  lte80: Record<string, number | null>;
  gt80: Record<string, number | null>;
  floating: number | null;
}

export type CardedData = {
  scrapedAt: string;                  // ISO timestamp of the scrape run
  source: 'interest.co.nz/borrowing';
  rateCard: CardedRateCard;
};

export type IngestionResult = {
  bankId: BankId;
  messageId: string;
  subject: string;
  date: string;
  // 'vision'       = images only (legacy)
  // 'vision+pdf'   = PDF attachment(s) only
  // 'vision+both'  = images + PDF(s) together
  parser: 'text' | 'vision' | 'vision+pdf' | 'vision+both' | 'manual';
  status: 'success' | 'partial' | 'failed' | 'needs_review';
  patch?: Partial<BankData>;
  changes?: Record<string, unknown>;
  error?: string;
  needsReview?: boolean;
};
