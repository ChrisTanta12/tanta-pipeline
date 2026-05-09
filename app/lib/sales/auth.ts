/**
 * Auth gate for /api/sales/* endpoints.
 *
 * Two ways to authorise:
 *  1. The same `tanta_finance` cookie used by /finance — set when a user
 *     types the FINANCE_PIN. Used by browser visits to /sales.
 *  2. `Authorization: Bearer <SALES_API_TOKEN>` header — used by the
 *     sales-manager Claude skill and the weekly digest cron, which
 *     run outside a browser session.
 *
 * Either is sufficient. If neither is set in env, we fail closed
 * (return false) so an under-configured deploy can't accidentally
 * expose pipeline data.
 */
import type { NextRequest } from 'next/server';
import { isFinanceUnlocked } from '../finance-auth';

export function isSalesAuthorized(req: NextRequest): boolean {
  if (isFinanceUnlocked()) return true;

  const expected = process.env.SALES_API_TOKEN;
  if (!expected) return false;

  const header = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return false;
  // Constant-time compare via length + char-by-char since the secret is
  // short and we don't want to pull in node:crypto for one comparison.
  const got = m[1];
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
