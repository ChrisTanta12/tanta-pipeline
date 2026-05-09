/**
 * Markdown → Postgres sync for the manual KiwiSaver conversions tracker.
 *
 * Reads a markdown file containing a single table of mortgage clients who
 * have become KS clients, parses the rows, and upserts them into the
 * ks_conversions table. Rows in the table that no longer appear in the
 * markdown are removed (so deletions in the source propagate).
 *
 * Source path resolves in this order:
 *   1. KS_CONVERSIONS_MARKDOWN_PATH env var
 *   2. ./ks-conversions.md (repo-local)
 *
 * Future: when Trail's KS pipeline tagging is reliable, swap this script
 * for a Trail KS pipeline ingest. The destination table is the same so
 * /api/sales/ks-attach won't need to change.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pruneKsConversions, upsertKsConversion } from '../app/lib/sales/db';
import type { KsConversionRow } from '../app/lib/sales/metrics';

function resolveSourcePath(): string {
  const fromEnv = process.env.KS_CONVERSIONS_MARKDOWN_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const repoLocal = resolve(process.cwd(), 'ks-conversions.md');
  if (existsSync(repoLocal)) return repoLocal;
  throw new Error(
    'ks-conversions markdown not found. Set KS_CONVERSIONS_MARKDOWN_PATH or place a ks-conversions.md at the repo root.',
  );
}

/**
 * Parses the first markdown table in `text`, expecting these columns
 * (case-insensitive header match):
 *   profile_id | name | email | mortgage_settled | ks_signed | notes
 */
export function parseKsMarkdown(text: string): KsConversionRow[] {
  const lines = text.split(/\r?\n/);
  const rows: KsConversionRow[] = [];
  let inTable = false;
  let headers: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inTable) {
      if (trimmed.startsWith('|') && trimmed.toLowerCase().includes('profile')) {
        headers = trimmed.split('|').map((s) => s.trim().toLowerCase()).filter(Boolean);
        inTable = true;
      }
      continue;
    }
    if (!trimmed.startsWith('|')) {
      // Table ended (blank line or section break).
      if (rows.length > 0) break;
      continue;
    }
    // Skip the separator row (---|---|...).
    if (/^\|[\s|:-]+\|?$/.test(trimmed)) continue;
    const cells = trimmed.split('|').map((s) => s.trim());
    // Discard leading/trailing empty splits caused by edge pipes.
    if (cells[0] === '') cells.shift();
    if (cells[cells.length - 1] === '') cells.pop();
    if (cells.length < headers.length) continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = cells[i] ?? ''; });
    if (!obj['profile_id'] || !obj['ks_signed']) continue;
    rows.push({
      profileId: obj['profile_id'],
      name: obj['name'] || null,
      email: obj['email'] || null,
      mortgageSettled: obj['mortgage_settled'] || null,
      ksSigned: obj['ks_signed'],
    });
  }
  return rows;
}

async function main() {
  const path = resolveSourcePath();
  console.log(`→ reading ${path}`);
  const text = readFileSync(path, 'utf8');
  const rows = parseKsMarkdown(text);
  if (rows.length === 0) {
    console.log('   no rows found in source. Did you keep the header row intact?');
  }
  for (const r of rows) {
    await upsertKsConversion(r);
  }
  const removed = await pruneKsConversions(rows.map((r) => r.profileId));
  console.log(`✓ upserted ${rows.length} rows, pruned ${removed} stale rows`);
}

main().catch((err) => {
  console.error('✗ failed:', err.message);
  process.exit(1);
});
