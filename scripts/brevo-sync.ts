/**
 * Brevo → Postgres contacts sync.
 *
 * Pulls contacts from the Brevo API into the brevo_contacts cache table.
 * Incremental: each run resumes from the last successful run's modifiedAt
 * watermark. First run pulls everything (modifiedSince=epoch).
 *
 * Usage: npm run brevo:sync
 *
 * Requires: BREVO_API_KEY in .env.local (the "Claude Link" key documented
 * in memory: project_brevo_integration.md).
 */
import {
  finishBrevoSyncRun,
  getBrevoWatermark,
  startBrevoSyncRun,
  upsertBrevoContact,
} from '../app/lib/sales/db';

type BrevoContactPayload = {
  id: number;
  email: string;
  emailBlacklisted?: boolean;
  smsBlacklisted?: boolean;
  createdAt?: string;
  modifiedAt?: string;
  listIds?: number[];
  attributes?: Record<string, unknown>;
};

const BREVO_BASE = 'https://api.brevo.com/v3';
const PAGE_LIMIT = 500;

async function fetchPage(
  apiKey: string,
  modifiedSince: string,
  offset: number,
): Promise<BrevoContactPayload[]> {
  const url = new URL(`${BREVO_BASE}/contacts`);
  url.searchParams.set('limit', String(PAGE_LIMIT));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('modifiedSince', modifiedSince);
  url.searchParams.set('sort', 'asc');
  const res = await fetch(url.toString(), {
    headers: { 'api-key': apiKey, 'accept': 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Brevo ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { contacts?: BrevoContactPayload[] };
  return json.contacts ?? [];
}

async function main() {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error('Missing BREVO_API_KEY in env. Set it in .env.local.');
    process.exit(1);
  }

  const lastWatermark = await getBrevoWatermark();
  const since = lastWatermark ?? '1970-01-01T00:00:00.000Z';
  console.log(`→ syncing Brevo contacts modified since ${since}`);

  const runId = await startBrevoSyncRun();
  let seen = 0;
  let upserted = 0;
  let highest = lastWatermark;
  try {
    let offset = 0;
    for (;;) {
      const batch = await fetchPage(apiKey, since, offset);
      if (batch.length === 0) break;
      for (const c of batch) {
        seen++;
        if (!c.email) continue;
        await upsertBrevoContact({
          email: c.email.toLowerCase(),
          brevoId: c.id ?? null,
          createdAt: c.createdAt ?? null,
          modifiedAt: c.modifiedAt ?? null,
          attributes: c.attributes ?? {},
          listIds: c.listIds ?? [],
        });
        upserted++;
        if (c.modifiedAt && (!highest || c.modifiedAt > highest)) {
          highest = c.modifiedAt;
        }
      }
      console.log(`   page offset=${offset} processed=${batch.length}`);
      if (batch.length < PAGE_LIMIT) break;
      offset += PAGE_LIMIT;
    }
    await finishBrevoSyncRun(runId, 'done', seen, upserted, highest, null);
    console.log(`✓ done — ${upserted} contacts upserted, watermark=${highest}`);
  } catch (err: any) {
    await finishBrevoSyncRun(runId, 'failed', seen, upserted, highest, err.message);
    console.error('✗ failed:', err.message);
    process.exit(1);
  }
}

main();
