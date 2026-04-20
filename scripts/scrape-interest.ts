/**
 * Manually runs the interest.co.nz scraper and writes carded rate cards into
 * banks.carded_data. Equivalent to hitting /api/scrape-interest but bypasses
 * the HTTP layer — useful for local testing.
 *
 * Usage: npm run scrape:interest
 */
import { scrapeInterestCoNz } from '../app/lib/scrapers/interestCoNz';
import { upsertCardedData } from '../app/lib/db';
import type { BankId, CardedData } from '../app/lib/types';

async function main() {
  console.log('→ fetching https://www.interest.co.nz/borrowing ...');
  const result = await scrapeInterestCoNz();
  console.log(`✓ fetched at ${result.fetchedAt}`);
  if (result.warnings.length) {
    console.log('⚠ warnings:');
    for (const w of result.warnings) console.log('  -', w);
  }

  for (const [bankId, rateCard] of Object.entries(result.banks) as Array<[BankId, NonNullable<typeof result.banks[BankId]>]>) {
    if (!rateCard) continue;
    const payload: CardedData = {
      scrapedAt: result.fetchedAt,
      source: 'interest.co.nz/borrowing',
      rateCard,
    };
    await upsertCardedData(bankId, payload);
    const terms = Object.keys(rateCard.gt80).length + Object.keys(rateCard.lte80).length;
    console.log(`  ✓ ${bankId}: ${terms} term values, floating=${rateCard.floating ?? '—'}`);
  }

  console.log(`\n✓ updated ${Object.keys(result.banks).length} banks`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
