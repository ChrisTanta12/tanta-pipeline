import type { BankData } from '../types';
import type { BankEmail } from '../gmail';

/**
 * ANZ The Insider emails are HTML with rates embedded as styled tables/images.
 * Plaintext is usually empty or very sparse — vision handles these.
 * This parser just captures the effective date if present.
 */
export function parseAnz(email: BankEmail): Partial<BankData> | null {
  const txt = (email.plaintext + ' ' + email.htmlBody.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  if (!txt.trim()) return null;
  const patch: Partial<BankData> = {};
  const eff = txt.match(/effective\s+\w+\s+(\d{1,2}\s+\w+)\s+at\s+\d+am/i);
  if (eff) patch.fees = { ...(patch.fees ?? {}), rateCardEffectiveDate: eff[1] };
  return Object.keys(patch).length ? patch : null;
}
