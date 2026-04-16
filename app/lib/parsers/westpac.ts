import type { BankData } from '../types';
import type { BankEmail } from '../gmail';

/**
 * Westpac Mortgage Adviser rate cards are entirely image-based.
 * Plaintext only has the effective date.
 */
export function parseWestpac(email: BankEmail): Partial<BankData> | null {
  const txt = email.plaintext;
  if (!txt) return null;
  const patch: Partial<BankData> = {};
  const eff = txt.match(/current as at\s+(\d{1,2}\s+\w+\s+\d{4})/i);
  if (eff) {
    patch.fees = { ...(patch.fees ?? {}), rateCardEffectiveDate: eff[1] };
  }
  return Object.keys(patch).length ? patch : null;
}
