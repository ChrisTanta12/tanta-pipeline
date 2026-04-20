import { NextRequest, NextResponse } from 'next/server';
import { scrapeInterestCoNz } from '@/app/lib/scrapers/interestCoNz';
import { upsertCardedData } from '@/app/lib/db';
import type { BankId, CardedData } from '@/app/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Cron endpoint. Scrapes interest.co.nz/borrowing once and writes the
 * carded rate card for each tracked bank to banks.carded_data. Runs in
 * parallel to /api/ingest-bank-updates — the two sources are compared in
 * the UI so broker specials vs public rates can be evaluated side-by-side.
 *
 * Auth: same Bearer-CRON_SECRET pattern as /api/ingest-bank-updates.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const runAt = new Date().toISOString();
  let scrape;
  try {
    scrape = await scrapeInterestCoNz();
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Scrape failed', detail: err.message, runAt },
      { status: 502 },
    );
  }

  const results: Array<{ bankId: BankId; status: 'success' | 'skipped'; terms: number }> = [];
  let banksUpdated = 0;

  for (const [bankId, rateCard] of Object.entries(scrape.banks) as Array<[BankId, NonNullable<typeof scrape.banks[BankId]>]>) {
    if (!rateCard) {
      results.push({ bankId, status: 'skipped', terms: 0 });
      continue;
    }
    const payload: CardedData = {
      scrapedAt: scrape.fetchedAt,
      source: 'interest.co.nz/borrowing',
      rateCard,
    };
    await upsertCardedData(bankId, payload);
    banksUpdated++;
    results.push({
      bankId,
      status: 'success',
      terms: Object.keys(rateCard.gt80).length + Object.keys(rateCard.lte80).length,
    });
  }

  return NextResponse.json({
    runAt,
    banksUpdated,
    warnings: scrape.warnings,
    results,
  });
}
