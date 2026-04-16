import type { BankData } from '../types';
import type { BankEmail } from '../gmail';

/**
 * Kiwibank Adviser Matrix Pricing emails: matrix rates and traffic lights are in images.
 * Plaintext contains the matrix validity date and some traffic-light text.
 */
export function parseKiwibank(email: BankEmail): Partial<BankData> | null {
  const txt = email.plaintext;
  if (!txt) return null;

  const patch: Partial<BankData> = {};

  // Matrix validity: "valid through 19 April 2026"
  const validity = txt.match(/valid through\s+([\d]{1,2}\s+\w+\s+\d{4})/i);
  if (validity) {
    patch.commission = { ...(patch.commission ?? {}), matrixValidUntil: validity[1] };
  }

  return Object.keys(patch).length ? patch : null;
}
