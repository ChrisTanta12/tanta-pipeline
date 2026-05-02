/**
 * Exports the canonical Postgres data as a single JSON snapshot for Cowork
 * sessions to read. The snapshot is the bridge between the Vercel app
 * (system of record) and Cowork (conversational analysis surface).
 *
 * Output: <FINANCE_SNAPSHOT_PATH>/tanta_finance_snapshot.json
 *   - default if env var unset: ./tanta_finance_snapshot.json (current dir)
 *   - production setting: a Google Drive folder synced to Chris's + Anthony's
 *     machines so both can run Cowork against the same snapshot
 *
 * Usage: npm run finance:snapshot
 *
 * See:
 *   - docs/COWORK_SETUP.md for how Chris/Anthony point Cowork at this file
 *   - app/lib/finance-types.ts for the FinanceSnapshot shape
 *   - memory/project_tanta_finance_architecture.md for the why
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import {
  getRecentCycles,
  getCurrentConfig,
  getCapitalMovementsRecent,
  computeHistoryAggregates,
} from '../app/lib/finance-db';
import type { FinanceSnapshot } from '../app/lib/finance-types';

async function main() {
  const cycles = await getRecentCycles(13);
  const config = await getCurrentConfig();
  const capitalMovements = await getCapitalMovementsRecent(50);
  const historyAggregates = await computeHistoryAggregates(cycles);

  if (!config) {
    throw new Error('No active finance_config row. Run npm run finance:seed first.');
  }

  const snapshot: FinanceSnapshot = {
    schema_version: '1.0.0',
    generated_at: new Date().toISOString(),
    config,
    cycles,
    capital_movements: capitalMovements,
    history_aggregates: historyAggregates,
  };

  const outDir = process.env.FINANCE_SNAPSHOT_PATH || process.cwd();
  const resolvedDir = isAbsolute(outDir) ? outDir : join(process.cwd(), outDir);
  mkdirSync(resolvedDir, { recursive: true });
  const outPath = join(resolvedDir, 'tanta_finance_snapshot.json');
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

  console.log(`✓ Snapshot written: ${outPath}`);
  console.log(`  schema_version: ${snapshot.schema_version}`);
  console.log(`  fortnights: ${cycles.length}`);
  console.log(`  capital_movements: ${capitalMovements.length}`);
  console.log(`  generated_at: ${snapshot.generated_at}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
