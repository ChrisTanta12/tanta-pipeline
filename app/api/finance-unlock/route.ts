import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'node:crypto';

export const dynamic = 'force-dynamic';

/**
 * Auth gate for the /finance route.
 *
 * Why this exists vs reusing /api/exec-check:
 *  - exec-check is stateless and only sets a client-side localStorage flag.
 *    Financial data is more sensitive than the existing exec-mode commission
 *    fields, so we want server-side enforcement, not just UI gating.
 *  - This endpoint validates the PIN and (on success) sets an HttpOnly,
 *    Signed cookie. Subsequent requests to /api/finance-* check the cookie
 *    server-side via verifyFinanceCookie() in app/lib/finance-auth.ts.
 *  - Cookie is HMAC-signed with FINANCE_COOKIE_SECRET so a client can't
 *    forge it.
 *
 * PIN:
 *  - Reads from FINANCE_PIN env var (separate from EXEC_PIN so the access
 *    list / scope can be different).
 *  - Falls back to EXEC_PIN if FINANCE_PIN isn't set, so it works out of
 *    the box on existing deployments.
 *
 * KNOWN LIMITATIONS — flagged for upgrade before this is "production":
 *  - No per-user identity. Anyone with the PIN can unlock.
 *  - No rate limiting on PIN attempts.
 *  - No audit log of access events.
 *  - Cookie is valid until exp (8h); no remote revoke.
 *  See `Tanta-Finance/integrations/xero.md` and the architecture memo
 *  for the path to NextAuth / Clerk replacement.
 */

const COOKIE_NAME = 'tanta_finance';
const COOKIE_TTL_SECONDS = 8 * 60 * 60; // 8 hours

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export async function POST(req: NextRequest) {
  const expected = process.env.FINANCE_PIN || process.env.EXEC_PIN;
  const cookieSecret = process.env.FINANCE_COOKIE_SECRET || process.env.EXEC_PIN;
  if (!expected || !cookieSecret) {
    return NextResponse.json(
      { ok: false, error: 'FINANCE_PIN / FINANCE_COOKIE_SECRET not configured' },
      { status: 500 },
    );
  }

  let pin: string | undefined;
  try {
    ({ pin } = await req.json());
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (typeof pin !== 'string' || pin !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Mint signed cookie value: "<exp>.<sig>"
  const exp = Math.floor(Date.now() / 1000) + COOKIE_TTL_SECONDS;
  const payload = String(exp);
  const sig = sign(payload, cookieSecret);
  const cookieValue = `${payload}.${sig}`;

  const res = NextResponse.json({ ok: true, expiresAt: exp * 1000 });
  res.cookies.set({
    name: COOKIE_NAME,
    value: cookieValue,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_TTL_SECONDS,
  });
  return res;
}

/** DELETE clears the cookie (logout). */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    path: '/',
    maxAge: 0,
  });
  return res;
}
