import type { BankData } from '../types';
import type { BankEmail } from '../gmail';

/**
 * ASB Home Happenings emails contain plaintext rate tables like:
 *
 *   6 months     4.49%    4.49%    4.49%
 *   1 year       4.59%    4.49%    4.59%
 *
 * We parse the 0-80% LVR (col 2) and >80% LVR (col 3) numbers per term.
 */
export function parseAsb(email: BankEmail): Partial<BankData> | null {
  const txt = email.plaintext;
  if (!txt) return null;

  const patch: Partial<BankData> = {};
  const rateCard: NonNullable<BankData['rateCard']> = {};

  const termPatterns: Array<[string, RegExp]> = [
    ['6mo',      /6\s*months?\s+[\d.]+%\s+([\d.]+)%\s+([\d.]+)%/i],
    ['1y',       /1\s*year\s+[\d.]+%\s+([\d.]+)%\s+([\d.]+)%/i],
    ['18mo',     /18\s*months\s+[\d.]+%\s+([\d.]+)%\s+([\d.]+)%/i],
    ['2y',       /2\s*years?\s+[\d.]+%\s+([\d.]+)%\s+([\d.]+)%/i],
    ['3y',       /3\s*years?\s+[\d.]+%\s+([\d.]+)%\s+([\d.]+)%/i],
    ['4y',       /4\s*years?\s+[\d.]+%\s+([\d.]+)%\s+([\d.]+)%/i],
    ['5y',       /5\s*years?\s+[\d.]+%\s+([\d.]+)%\s+([\d.]+)%/i],
  ];
  for (const [key, re] of termPatterns) {
    const m = txt.match(re);
    if (m) rateCard[key] = { lte80: parseFloat(m[1]), gt80: parseFloat(m[2]) };
  }
  // Floating (Housing Variable / Orbit) line has a different shape
  const orbitMatch = txt.match(/Orbit Variable\s+Variable\s+[\d.]+%\s+([\d.]+)%\s+([\d.]+)%/i);
  if (orbitMatch) rateCard['floating'] = { lte80: parseFloat(orbitMatch[1]), gt80: parseFloat(orbitMatch[2]) };

  if (Object.keys(rateCard).length) patch.rateCard = rateCard;

  // Service test rate: "ASB's Servicing Test Rate is 7.00%."
  const str = txt.match(/Servicing Test Rate is\s+([\d.]+)%/i);
  if (str) patch.serviceRate = parseFloat(str[1]);

  // Turnaround: "ASB New Home Lending Applications  4 business days"
  const retail = txt.match(/New Home Lending Applications\s+(\d+)\s+business days?/i);
  const biz = txt.match(/Business Banking Lending Applications\s+(\d+)\s+business days?/i);
  if (retail || biz) {
    patch.turnaround = {
      retail: retail ? parseInt(retail[1], 10) : (undefined as any),
      business: biz ? parseInt(biz[1], 10) : (undefined as any),
    };
  }

  // Cashback: "Up to 0.90% max $20,000"
  const cb = txt.match(/Up to\s+([\d.]+)%\s+max\s+\$([\d,]+)/i);
  if (cb) {
    patch.cashback = {
      pctLte80: parseFloat(cb[1]) / 100,
      maxLte80: parseInt(cb[2].replace(/,/g, ''), 10),
    };
  }
  // FHB cashback
  const fhb = txt.match(/First Home Buyer[\s\S]*?\$([\d,]+)/i);
  if (fhb && !patch.cashback) patch.cashback = {};
  if (fhb) (patch.cashback as any).fhb = parseInt(fhb[1].replace(/,/g, ''), 10);

  // Traffic light signals — ASB uses phrases like "moving our traffic lights to RED for"
  // Too freeform to regex reliably; let vision handle this if it matters.

  return Object.keys(patch).length ? patch : null;
}
