import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * TAT override PIN check. Verifies a submitted PIN against the TAT_PIN env var
 * (server-side only). Separate from EXEC_PIN so the exec view and TAT override
 * can have different shared secrets.
 *
 * Falls back to "1111" when TAT_PIN is unset so local dev works out of the box.
 * Chris will set TAT_PIN in Vercel for production.
 *
 * Mirrors the shape of /api/exec-check.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.TAT_PIN ?? '1111';
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
