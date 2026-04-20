import { sql } from '@vercel/postgres';
import type { BankData, BankId, CardedData, LegacyTurnaround, TurnaroundEntry, TurnaroundMap } from './types';

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

/**
 * Detects the legacy `{ retail, business }` turnaround shape that existing
 * parsers (app/lib/parsers/asb.ts, bnz.ts) and the vision prompt in
 * anthropic.ts still produce. Converts it to the new TurnaroundMap with
 * "Retail" / "Business" keys, stamped as `source: 'auto'`.
 */
function isLegacyTurnaround(v: unknown): v is LegacyTurnaround {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  // Legacy shape has retail/business keys and no entry value shaped like TurnaroundEntry.
  const hasLegacyKey = 'retail' in o || 'business' in o;
  if (!hasLegacyKey) return false;
  // If the value at retail/business looks like a TurnaroundEntry, treat as new shape.
  for (const k of ['retail', 'business']) {
    const entry = o[k];
    if (entry && typeof entry === 'object' && 'days' in (entry as object) && 'source' in (entry as object)) {
      return false;
    }
  }
  return true;
}

function normalizeTurnaroundPatch(incoming: unknown, now: string): TurnaroundMap | null {
  if (!incoming || typeof incoming !== 'object') return null;
  if (isLegacyTurnaround(incoming)) {
    const legacy = incoming as LegacyTurnaround;
    const out: TurnaroundMap = {};
    if (legacy.retail !== undefined && legacy.retail !== null && (legacy.retail as unknown) !== '') {
      out['Retail'] = { days: legacy.retail as number | string, updatedAt: now, source: 'auto' };
    }
    if (legacy.business !== undefined && legacy.business !== null && (legacy.business as unknown) !== '') {
      out['Business'] = { days: legacy.business as number | string, updatedAt: now, source: 'auto' };
    }
    return out;
  }
  // Assume already a TurnaroundMap — coerce any entry lacking updatedAt/source to defaults.
  const out: TurnaroundMap = {};
  for (const [key, raw] of Object.entries(incoming as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<TurnaroundEntry> & { days?: unknown };
    if (r.days === undefined || r.days === null || r.days === '') continue;
    out[key] = {
      days: r.days as number | string,
      updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : now,
      source: r.source === 'manual' ? 'manual' : 'auto',
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Merges a turnaround patch into an existing TurnaroundMap with per-key
 * precedence: if a key is already present with `source: 'manual'`, it wins
 * (auto-ingest can't clobber admin overrides). Otherwise the incoming entry
 * wins.
 */
function mergeTurnaroundMaps(existing: TurnaroundMap | undefined, incoming: TurnaroundMap): TurnaroundMap {
  const out: TurnaroundMap = { ...(existing ?? {}) };
  for (const [key, entry] of Object.entries(incoming)) {
    const prior = out[key];
    if (prior && prior.source === 'manual' && entry.source !== 'manual') {
      // Manual wins; skip auto overwrite.
      continue;
    }
    out[key] = entry;
  }
  return out;
}

export async function mergeBankData(id: BankId, patch: Partial<BankData> & { turnaround?: unknown }): Promise<BankData> {
  // Shim the legacy turnaround shape at the db-write layer so existing
  // parsers/vision prompts keep working without rewrites. Merge per-key
  // against the existing map so manual overrides survive auto ingests.
  const patchToWrite: Record<string, unknown> = { ...patch };
  if (patch.turnaround !== undefined) {
    const now = new Date().toISOString();
    const incoming = normalizeTurnaroundPatch(patch.turnaround, now);
    if (incoming) {
      const { rows } = await sql<{ data: BankData }>`
        SELECT data FROM banks WHERE id = ${id}
      `;
      // Persisted shape is always TurnaroundMap (any legacy shape from an
      // earlier write would've been normalised before landing here). Safe to
      // narrow the union for the merge.
      const existing = rows[0]?.data?.turnaround as TurnaroundMap | undefined;
      patchToWrite.turnaround = mergeTurnaroundMaps(existing, incoming);
    } else {
      delete patchToWrite.turnaround;
    }
  }

  const { rows } = await sql<{ data: BankData }>`
    UPDATE banks
    SET data = data || ${JSON.stringify(patchToWrite)}::jsonb,
        updated_at = NOW()
    WHERE id = ${id}
    RETURNING data
  `;
  if (rows.length === 0) throw new Error(`Bank ${id} not found`);
  return rows[0].data;
}

/**
 * Upserts a single manual TAT entry for a bank. Used by /api/tat-override.
 * Always writes `source: 'manual'` and a fresh `updatedAt`. Returns the
 * full updated turnaround map.
 */
export async function upsertTurnaroundOverride(
  id: BankId,
  category: string,
  days: number | string,
): Promise<TurnaroundMap> {
  const entry: TurnaroundEntry = {
    days,
    updatedAt: new Date().toISOString(),
    source: 'manual',
  };
  const { rows } = await sql<{ data: BankData }>`SELECT data FROM banks WHERE id = ${id}`;
  if (rows.length === 0) throw new Error(`Bank ${id} not found`);
  const existing = (rows[0].data?.turnaround ?? {}) as TurnaroundMap;
  const next: TurnaroundMap = { ...existing, [category]: entry };
  await sql`
    UPDATE banks
    SET data = jsonb_set(data, '{turnaround}', ${JSON.stringify(next)}::jsonb, true),
        updated_at = NOW()
    WHERE id = ${id}
  `;
  return next;
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
