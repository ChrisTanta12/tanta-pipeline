import type { BankEmail } from './gmail';
import { parseAttachmentsWithVision } from './anthropic';
import type { BankData, BankId, IngestionResult } from './types';

/**
 * Runs the bank-update ingest pipeline against a single fetched email.
 *
 * Returns an IngestionResult describing what the text parser found (and,
 * if text coverage was thin, what the vision fallback extracted from
 * inline images + PDF attachments). Does not touch the database — the
 * caller decides whether to persist, log, or just inspect.
 *
 * Extracted from app/api/ingest-bank-updates/route.ts so the scripted
 * test harness (scripts/test-pdf-ingest.ts) can reuse the same logic.
 * Next.js app-router files are not allowed to export arbitrary symbols.
 */
export async function processEmail(
  bankId: BankId,
  email: BankEmail,
  textParser: (e: BankEmail) => Partial<BankData> | null,
  // Kept in the signature for caller compatibility, but the runtime gate now
  // relies on actual attachments attached to the email rather than the
  // per-bank hint. Banks may start (or stop) attaching PDFs at any time.
  _hasImageContent: boolean,
): Promise<IngestionResult> {
  // 1. Try text parser first
  const textPatch = textParser(email);
  const textFieldCount = textPatch ? countScalarFields(textPatch) : 0;

  // 2. Collect vision-eligible attachments — both inline images and PDF
  //    attachments (Kiwibank sends a PDF rate card; their text body is thin).
  const images = email.inlineImages
    .filter(i => ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'].includes(i.mimeType))
    .map(i => ({ mimeType: i.mimeType, data: i.data }));
  const pdfs = email.attachments
    .filter(a => a.mimeType === 'application/pdf')
    .map(a => ({ mimeType: a.mimeType, data: a.data, filename: a.filename }));

  // 3. If the text parser found little AND there's any vision-eligible
  //    attachment, ask Claude to extract from images + PDFs.
  let patch: Partial<BankData> = textPatch ?? {};
  let parser: IngestionResult['parser'] = 'text';
  let needsReview = false;
  let error: string | undefined;

  if ((images.length > 0 || pdfs.length > 0) && textFieldCount < 3) {
    try {
      const visionResult = await parseAttachmentsWithVision(bankId, images, pdfs, email.subject);
      patch = { ...patch, ...visionResult.patch };
      parser =
        images.length > 0 && pdfs.length > 0
          ? 'vision+both'
          : pdfs.length > 0
          ? 'vision+pdf'
          : 'vision';
      if (visionResult.confidence !== 'high') needsReview = true;
    } catch (err: any) {
      error = `Vision parse failed: ${err.message}`;
      needsReview = true;
    }
  } else if (textFieldCount === 0) {
    needsReview = true;
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

export function countScalarFields(patch: Partial<BankData>): number {
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

export function summariseChanges(patch: Partial<BankData>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    summary[k] = typeof v === 'object' ? Object.keys(v ?? {}) : v;
  }
  return summary;
}
