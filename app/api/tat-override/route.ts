import { NextRequest, NextResponse } from 'next/server';
import { upsertTurnaroundOverride, BANK_IDS } from '@/app/lib/db';
import type { BankId } from '@/app/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Admin TAT override endpoint. Upserts a single turnaround category for a
 * bank with `source: 'manual'` so auto-ingest can't overwrite it.
 *
 * Auth: checks the x-tat-pin request header against TAT_PIN env var (default
 * "1111" when unset). Mirrors the pattern used by /api/exec-check but lifts
 * the PIN from a header rather than the body so the body can carry the
 * payload.
 *
 * Body: { bankId, category, days }
 * Response: { turnaround: TurnaroundMap }
 */
export async function POST(req: NextRequest) {
  const expected = process.env.TAT_PIN ?? '1111';
  const pin = req.headers.get('x-tat-pin');
  if (!pin || pin !== expected) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: { bankId?: string; category?: string; days?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { bankId, category, days } = body;
  if (!bankId || typeof bankId !== 'string' || !BANK_IDS.includes(bankId as BankId)) {
    return NextResponse.json({ ok: false, error: 'Invalid bankId' }, { status: 400 });
  }
  if (!category || typeof category !== 'string' || category.trim().length === 0) {
    return NextResponse.json({ ok: false, error: 'Invalid category' }, { status: 400 });
  }
  // days can be a number, a numeric-string, or an already-freeform string like "up to 7".
  if (days === undefined || days === null || days === '') {
    return NextResponse.json({ ok: false, error: 'Invalid days' }, { status: 400 });
  }
  const daysValue: number | string =
    typeof days === 'number'
      ? days
      : typeof days === 'string'
        ? (Number.isFinite(Number(days)) && days.trim() !== '' ? Number(days) : days)
        : (() => {
            throw new Error('days must be number or string');
          })();

  try {
    const turnaround = await upsertTurnaroundOverride(bankId as BankId, category.trim(), daysValue);
    return NextResponse.json({ ok: true, bankId, turnaround });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: 'Failed to save override', detail: err?.message },
      { status: 500 },
    );
  }
}
