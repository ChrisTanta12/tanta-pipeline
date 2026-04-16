import { NextRequest, NextResponse } from 'next/server';
import { gmailClient, searchLabel, fetchMessage, type BankEmail } from '@/app/lib/gmail';
import { BANK_LABELS } from '@/app/lib/parsers';
import { parseImagesWithVision } from '@/app/lib/anthropic';
import { mergeBankData, isEmailProcessed, markEmailProcessed, writeLog } from '@/app/lib/db';
import type { BankData, BankId, IngestionResult } from '@/app/lib/types';

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
          parser: result.parser,
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

async function processEmail(
  bankId: BankId,
  email: BankEmail,
  textParser: (e: BankEmail) => Partial<BankData> | null,
  hasImageContent: boolean,
): Promise<IngestionResult> {
  // 1. Try text parser first
  const textPatch = textParser(email);
  const textFieldCount = textPatch ? countScalarFields(textPatch) : 0;

  // 2. If the email carries rate-card images AND the text parser found little,
  //    ask Claude to extract from images.
  let patch: Partial<BankData> = textPatch ?? {};
  let parser: 'text' | 'vision' = 'text';
  let needsReview = false;
  let error: string | undefined;

  if (hasImageContent && textFieldCount < 3) {
    const images = email.inlineImages
      .filter(i => ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'].includes(i.mimeType))
      .map(i => ({ mimeType: i.mimeType, data: i.data }));

    if (images.length > 0) {
      try {
        const visionResult = await parseImagesWithVision(bankId, images, email.subject);
        patch = { ...patch, ...visionResult.patch };
        parser = 'vision';
        if (visionResult.confidence !== 'high') needsReview = true;
      } catch (err: any) {
        error = `Vision parse failed: ${err.message}`;
        needsReview = true;
      }
    } else if (textFieldCount === 0) {
      needsReview = true;
    }
  }

  const status = error
    ? 'failed'
    : Object.keys(patch).length === 0
    ? 'needs_review'
    : needsReview
    ? 'needs_review'
    : 'success';

  return {
    bankId,
    messageId: email.messageId,
    subject: email.subject,
    date: email.date,
    parser,
    status,
    patch: Object.keys(patch).length ? patch : undefined,
    changes: summariseChanges(patch),
    error,
    needsReview,
  };
}

function countScalarFields(patch: Partial<BankData>): number {
  let n = 0;
  const walk = (v: unknown) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'object' && !Array.isArray(v)) {
      for (const val of Object.values(v as Record<string, unknown>)) walk(val);
    } else {
      n++;
    }
  };
  walk(patch);
  return n;
}

function summariseChanges(patch: Partial<BankData>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    summary[k] = typeof v === 'object' ? Object.keys(v ?? {}) : v;
  }
  return summary;
}
