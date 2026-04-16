import type { BankData } from '../types';
import type { BankEmail } from '../gmail';

/**
 * BNZ weekly rate card emails have plaintext turnaround tables but rate cards in images.
 * We extract turnaround + cashback text here and leave rate card parsing to vision.
 */
export function parseBnz(email: BankEmail): Partial<BankData> | null {
  const txt = email.plaintext;
  if (!txt) return null;

  const patch: Partial<BankData> = {};

  // "Our current turnaround time for new applications is up to 7 business days"
  const retail = txt.match(/current turnaround time[^\n]*?up to\s+(\d+)\s+business days?/i);
  if (retail) {
    // BNZ only publishes one number publicly — use it for retail, leave business unchanged.
    patch.turnaround = { retail: parseInt(retail[1], 10), business: undefined as any };
  }

  // Cashback FHB minimum
  const fhb = txt.match(/First Home Buyer[\s\S]*?minimum of\s+\$([\d,]+)\s+cashback/i);
  if (fhb) {
    patch.cashback = { ...(patch.cashback ?? {}), fhb: parseInt(fhb[1].replace(/,/g, ''), 10) };
  }

  // Cashback up to 0.9%
  const cb = txt.match(/Up to\s+([\d.]+)%\s+of the new lending/i);
  if (cb) {
    patch.cashback = { ...(patch.cashback ?? {}), pctLte80: parseFloat(cb[1]) / 100 };
  }

  return Object.keys(patch).length ? patch : null;
}
