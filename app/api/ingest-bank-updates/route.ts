import { NextRequest, NextResponse } from 'next/server';
import { gmailClient, searchLabel, fetchMessage } from '@/app/lib/gmail';
import { BANK_LABELS } from '@/app/lib/parsers';
import { processEmail } from '@/app/lib/ingest';
import { mergeBankData, isEmailProcessed, markEmailProcessed, writeLog } from '@/app/lib/db';
import type { BankData, IngestionResult } from '@/app/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min — vision parsing can be slow

/**
 * Cron endpoint. Invoked by Vercel Cron (see vercel.json).
 * Auth: `Authorization: Bearer <CRON_SECRET>` required for external calls;
 *       Vercel Cron automatically adds this header when `CRON_SECRET` is set.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const gmail = gmailClient();
  const results: IngestionResult[] = [];

  for (const { label, bankId, textParser, hasImageContent } of BANK_LABELS) {
    try {
      const messageIds = await searchLabel(gmail, label, undefined, 5);
      for (const mid of messageIds) {
        if (await isEmailProcessed(mid)) continue;

        const email = await fetchMessage(gmail, mid);
        const result = await processEmail(bankId, email, textParser, hasImageContent);
        results.push(result);

        if (result.patch && Object.keys(result.patch).length > 0) {
          const patchWithSource: Partial<BankData> = {
            ...result.patch,
            lastSourceEmail: {
              id: email.messageId,
              subject: email.subject,
              date: email.date,
            },
          };
          await mergeBankData(bankId, patchWithSource);
        }

        await writeLog({
          bankId,
          gmailMessageId: email.messageId,
          gmailSubject: email.subject,
          gmailDate: email.date,
          // result.parser may be 'vision+pdf'/'vision+both' which are newer
          // variants than LogEntry.parser currently enumerates. The underlying
          // column is plain TEXT so the value is preserved; cast to bridge.
          parser: result.parser as 'text' | 'vision' | 'manual',
          status: result.status,
          changes: result.changes ?? null,
          error: result.error ?? null,
          needsReview: result.needsReview ?? false,
        });
        await markEmailProcessed(email.messageId, bankId);
      }
    } catch (err: any) {
      await writeLog({
        bankId,
        gmailMessageId: null,
        gmailSubject: null,
        gmailDate: null,
        parser: null,
        status: 'failed',
        changes: null,
        error: `Label scan failed: ${err.message}`,
        needsReview: true,
      });
      results.push({
        bankId,
        messageId: '',
        subject: '',
        date: '',
        parser: 'text',
        status: 'failed',
        error: err.message,
      });
    }
  }

  return NextResponse.json({
    runAt: new Date().toISOString(),
    processed: results.length,
    results,
  });
}
