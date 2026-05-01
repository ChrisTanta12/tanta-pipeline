/**
 * Server-side cookie verification for the /finance route.
 * See app/api/finance-unlock/route.ts for the corresponding mint.
 *
 * Cookie format: "<exp_unix_seconds>.<hmac_sha256_hex>"
 * HMAC key: FINANCE_COOKIE_SECRET (falls back to EXEC_PIN if unset).
 */
import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'tanta_finance';

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/** Returns true iff the request carries a valid, unexpired finance cookie. */
export function isFinanceUnlocked(): boolean {
  const secret = process.env.FINANCE_COOKIE_SECRET || process.env.EXEC_PIN;
  if (!secret) return false;
  const c = cookies().get(COOKIE_NAME);
  if (!c?.value) return false;

  const dot = c.value.indexOf('.');
  if (dot < 0) return false;
  const payload = c.value.slice(0, dot);
  const sig = c.value.slice(dot + 1);

  const expected = sign(payload, secret);
  if (!safeEqualHex(expected, sig)) return false;

  const exp = parseInt(payload, 10);
  if (!Number.isFinite(exp)) return false;
  return Date.now() / 1000 < exp;
}
