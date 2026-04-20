/**
 * One-off diagnostic: check what's in trail_profiles for Monique,
 * plus overall grading coverage. Run once:
 *   npm run db:debug
 */
import { sql } from '@vercel/postgres';

async function main() {
  console.log('--- Monique Hiskens in trail_profiles ---');
  const monique = await sql`
    SELECT profile_id, profile_rank, profile_status, synced_at
    FROM trail_profiles
    WHERE profile_id = '84d9b42b-fbe0-445c-8d54-1b6d5ce2bac6'
  `;
  console.log(monique.rows);

  console.log('\n--- Overall rank coverage across all 2,757 profiles ---');
  const coverage = await sql`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE profile_rank IS NULL)       AS null_rank,
      COUNT(*) FILTER (WHERE profile_rank = '')          AS empty_rank,
      COUNT(*) FILTER (WHERE profile_rank IN ('A','B','C','D','E','F')) AS graded
    FROM trail_profiles
  `;
  console.log(coverage.rows);

  console.log('\n--- Distinct profile_rank values ---');
  const distinct = await sql`
    SELECT profile_rank, COUNT(*) AS n
    FROM trail_profiles
    GROUP BY profile_rank
    ORDER BY n DESC
  `;
  console.log(distinct.rows);
}

main().catch(e => { console.error(e); process.exit(1); });
