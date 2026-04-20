export type BankId = 'anz' | 'asb' | 'bnz' | 'westpac' | 'kiwibank';

export type RateValue = number | string | null;

export interface RateRow {
  lte80: RateValue;
  gt80: RateValue;
}

export interface BankData {
  name?: string;
  resourcesFolderUrl?: string;
  rateCard?: Record<string, RateRow>;
  trafficLights?: {
    lte80?: { existing: string; new: string };
    '80_90'?: { existing: string; new: string };
  };
  turnaround?: { retail: number | string; business: number | string };
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
  parser: 'text' | 'vision' | 'manual';
  status: 'success' | 'partial' | 'failed' | 'needs_review';
  patch?: Partial<BankData>;
  changes?: Record<string, unknown>;
  error?: string;
  needsReview?: boolean;
};
