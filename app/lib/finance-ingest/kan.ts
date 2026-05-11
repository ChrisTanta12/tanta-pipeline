/**
 * KAN Commission Export xlsx parser. Reads the file produced by the KAN
 * portal and returns one line per invoice with Upfront / Trail classification.
 *
 * Mirrors Tanta-Finance/inputs/analyze_kan.mjs but in TypeScript using the
 * `xlsx` package already pulled in for tanta-pipeline.
 */
import * as XLSX from 'xlsx';
import type { KanLine } from './types';
import { parseFlexibleDate, isoDate } from './csv';

export function parseKanXlsx(buffer: ArrayBuffer): KanLine[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const lines: KanLine[] = [];
  for (const r of rows) {
    const provider = String(r['Provider'] ?? '').trim();
    // KAN sometimes interleaves repeated header rows — skip them
    if (!provider || provider === 'Provider') continue;
    const paid = parseFlexibleDate(String(r['KANPaymentDate'] ?? ''));
    if (!paid) continue;
    const t = String(r['CommissionType'] ?? '').trim();
    const commissionType: KanLine['commissionType'] =
      t === 'Upfront' ? 'Upfront' : t === 'Trail' ? 'Trail' : 'Other';
    lines.push({
      invoiceCode: String(r['InvoiceCode'] ?? '').trim(),
      provider,
      adviser: String(r['AdviserName'] ?? '').trim(),
      client: String(r['ClientName'] ?? '').trim(),
      paymentDate: isoDate(paid),
      loanAmount: parseFloat(String(r['LoanAmount'] ?? '0').replace(/,/g, '')) || 0,
      commission: parseFloat(String(r['CommissionPaid'] ?? '0').replace(/,/g, '')) || 0,
      commissionType,
    });
  }
  return lines;
}

/** Filter KAN lines to a fortnight window (inclusive at both ends). */
export function kanInWindow(lines: KanLine[], startIso: string, endIso: string): KanLine[] {
  return lines.filter(l => l.paymentDate >= startIso && l.paymentDate <= endIso);
}

/** Aggregate KAN lines into upfront / trail totals. */
export function kanTotals(lines: KanLine[]): { upfront: number; trail: number; other: number } {
  let upfront = 0, trail = 0, other = 0;
  for (const l of lines) {
    if (l.commissionType === 'Upfront') upfront += l.commission;
    else if (l.commissionType === 'Trail') trail += l.commission;
    else other += l.commission;
  }
  return { upfront, trail, other };
}
