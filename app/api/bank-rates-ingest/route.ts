import { NextRequest, NextResponse } from 'next/server';
import {
  mergeBankData,
  writeLog,
  markEmailProcessed,
  isEmailProcessed,
} from '@/app/lib/db';
import type { BankData, BankId, IngestionResult } from '@/app/lib/types';

export const dynamic = 'force-dynamic';

const VALID_BANK_IDS: BankId[] = ['anz', 'asb', 'bnz', 'westpac', 'kiwibank'];

/**
 * Receives parsed bank-rate data from an external agent (Google Apps Script
 * running under Chris's Workspace account, which has native Gmail access and
 * calls Gemini for the OCR/structured-extraction step). The agent does the
 * Gmail fetch + LLM parse; this endpoint just validates, dedupes, and writes.
 *
 * Auth: Authorization: Bearer <INGEST_SECRET>
 */
interface Payload {
  bankId: BankId;
  messageId: string;
  subject?: string;
  date?: string;
  patch?: Partial<BankData>;
  parser?: IngestionResult['parser'];
  status?: IngestionResult['status'];
  needsReview?: boolean;
  error?: string | null;
  notes?: string | null;
}

export async function POST(req: NextRequest) {
  const expected = process.env.INGEST_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'INGEST_SECRET not configured on server' },
      { status: 500 },
    );
  }
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.bankId || !VALID_BANK_IDS.includes(body.bankId)) {
    return NextResponse.json({ error: 'Invalid or missing bankId' }, { status: 400 });
  }
  if (!body.messageId || typeof body.messageId !== 'string') {
    return NextResponse.json({ error: 'Missing messageId' }, { status: 400 });
  }

  if (await isEmailProcessed(body.messageId)) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  const patch = body.patch ?? {};
  const hasData = Object.keys(patch).length > 0;

  if (hasData) {
    await mergeBankData(body.bankId, {
      ...patch,
      lastSourceEmail: {
        id: body.messageId,
        subject: body.subject ?? '',
        date: body.date ?? '',
      },
    });
  }

  await writeLog({
    bankId: body.bankId,
    gmailMessageId: body.messageId,
    gmailSubject: body.subject ?? null,
    gmailDate: body.date ?? null,
    parser: body.parser ?? 'vision',
    status: body.status ?? (hasData ? 'success' : 'needs_review'),
    changes: null,
    error: body.error ?? null,
    needsReview: body.needsReview ?? !hasData,
  });
  await markEmailProcessed(body.messageId, body.bankId);

  return NextResponse.json({ ok: true, merged: hasData });
}
