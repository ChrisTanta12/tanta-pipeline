import { sql } from '@vercel/postgres';
import type { BankData, BankId, CardedData } from './types';

export const BANK_IDS: BankId[] = ['anz', 'asb', 'bnz', 'westpac', 'kiwibank'];

export type BankRow = {
  id: BankId;
  name: string;
  data: BankData;
  updatedAt: string;
  cardedData: CardedData | null;
  cardedUpdatedAt: string | null;
};

export async function getAllBanks(): Promise<BankRow[]> {
  const { rows } = await sql<{
    id: BankId;
    name: string;
    data: BankData;
    updated_at: string;
    carded_data: CardedData | null;
    carded_updated_at: string | null;
  }>`
    SELECT id, name, data, updated_at, carded_data, carded_updated_at FROM banks ORDER BY name
  `;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    data: r.data,
    updatedAt: r.updated_at,
    cardedData: r.carded_data,
    cardedUpdatedAt: r.carded_updated_at,
  }));
}

/**
 * Writes scraped carded data to the banks row. Overwrites the entire
 * carded_data blob (the scraper always produces a full card per bank).
 * Does NOT touch `data` — that's the broker-email ingest's territory.
 */
export async function upsertCardedData(id: BankId, cardedData: CardedData): Promise<void> {
  await sql`
    UPDATE banks
    SET carded_data = ${JSON.stringify(cardedData)}::jsonb,
        carded_updated_at = NOW()
    WHERE id = ${id}
  `;
}

export async function upsertBank(id: BankId, name: string, data: BankData): Promise<void> {
  await sql`
    INSERT INTO banks (id, name, data, updated_at)
    VALUES (${id}, ${name}, ${JSON.stringify(data)}::jsonb, NOW())
    ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          data = EXCLUDED.data,
          updated_at = NOW()
  `;
}

export async function mergeBankData(id: BankId, patch: Partial<BankData>): Promise<BankData> {
  const { rows } = await sql<{ data: BankData }>`
    UPDATE banks
    SET data = data || ${JSON.stringify(patch)}::jsonb,
        updated_at = NOW()
    WHERE id = ${id}
    RETURNING data
  `;
  if (rows.length === 0) throw new Error(`Bank ${id} not found`);
  return rows[0].data;
}

export async function isEmailProcessed(messageId: string): Promise<boolean> {
  const { rows } = await sql`SELECT 1 FROM processed_emails WHERE gmail_message_id = ${messageId}`;
  return rows.length > 0;
}

export async function markEmailProcessed(messageId: string, bankId: BankId | null): Promise<void> {
  await sql`
    INSERT INTO processed_emails (gmail_message_id, bank_id)
    VALUES (${messageId}, ${bankId})
    ON CONFLICT (gmail_message_id) DO NOTHING
  `;
}

export type LogEntry = {
  bankId: BankId | null;
  gmailMessageId: string | null;
  gmailSubject: string | null;
  gmailDate: string | null;
  parser: 'text' | 'vision' | 'manual' | null;
  status: 'success' | 'partial' | 'failed' | 'needs_review';
  changes: Record<string, unknown> | null;
  error: string | null;
  needsReview: boolean;
};

export async function writeLog(entry: LogEntry): Promise<void> {
  await sql`
    INSERT INTO ingestion_log (
      bank_id, gmail_message_id, gmail_subject, gmail_date,
      parser, status, changes, error, needs_review, finished_at
    ) VALUES (
      ${entry.bankId}, ${entry.gmailMessageId}, ${entry.gmailSubject}, ${entry.gmailDate},
      ${entry.parser}, ${entry.status},
      ${entry.changes ? JSON.stringify(entry.changes) : null}::jsonb,
      ${entry.error}, ${entry.needsReview}, NOW()
    )
  `;
}

export async function recentLog(limit = 20) {
  const { rows } = await sql`
    SELECT * FROM ingestion_log
    ORDER BY started_at DESC
    LIMIT ${limit}
  `;
  return rows;
}
