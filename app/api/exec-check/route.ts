import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Executive PIN check. Verifies a submitted PIN against the EXEC_PIN env var
 * (server-side only — not exposed to the client bundle). On success the client
 * can persist a flag in localStorage to remember the unlocked state.
 *
 * This is deliberately minimal: the PIN is a shared secret for Tanta's internal
 * team, not a real auth system. Anyone with the PIN can toggle the exec view.
 * For proper per-user identity, swap in Clerk or similar later.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.EXEC_PIN;
  if (!expected) {
    return NextResponse.json({ ok: false, error: 'EXEC_PIN not configured' }, { status: 500 });
  }
  let pin: string | undefined;
  try {
    ({ pin } = await req.json());
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (typeof pin === 'string' && pin === expected) {
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false }, { status: 401 });
}
