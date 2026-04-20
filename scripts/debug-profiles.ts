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

  console.log('\n--- Monique opportunity → profile JOIN test ---');
  const joinTest = await sql`
    SELECT t.entity_id              AS opportunity_id,
           t.data->>'profileName'   AS profile_name,
           t.data->>'profileId'     AS opp_profileid_raw,
           LENGTH(t.data->>'profileId') AS opp_profileid_len,
           p.profile_id             AS matched_profile_id,
           p.profile_rank           AS matched_rank,
           p.profile_status         AS matched_status
    FROM trail_entities t
    LEFT JOIN trail_profiles p ON p.profile_id = t.data->>'profileId'
    WHERE t.kind = 'opportunity'
      AND t.data->>'profileName' ILIKE '%Monique Hiskens%'
    LIMIT 3
  `;
  console.log(joinTest.rows);

  console.log('\n--- Count of opps whose profileId has a match in trail_profiles ---');
  const matchCount = await sql`
    SELECT
      COUNT(*) AS total_opps,
      COUNT(*) FILTER (WHERE p.profile_id IS NOT NULL) AS with_match,
      COUNT(*) FILTER (WHERE p.profile_rank IS NOT NULL AND p.profile_rank != '') AS with_grade
    FROM trail_entities t
    LEFT JOIN trail_profiles p ON p.profile_id = t.data->>'profileId'
    WHERE t.kind = 'opportunity'
  `;
  console.log(matchCount.rows);
}

main().catch(e => { console.error(e); process.exit(1); });
