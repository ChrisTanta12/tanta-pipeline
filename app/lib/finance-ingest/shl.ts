/**
 * SHL (Sovereign Home Loans / ASB) commission CSV parser. Two file shapes
 * arrive via ASBAIMS@asb.co.nz attachments — trail-only schedules and grouped
 * (mixed upfront + trail) schedules. See
 * Tanta-Finance/inputs/analyze_shl.mjs for the original.
 *
 * The schedule type is detected from the file name + header presence (the
 * filenames we receive aren't guaranteed to follow the convention we use
 * internally, so we sniff the headers too).
 */
import { parseCSV, parseDollar, parseFlexibleDate, isoDate } from './csv';
import type { ShlLine } from './types';

type DetectedSchedule = 'trail' | 'grouped' | 'unknown';

/**
 * Detect the schedule type. Trail files have a `CommAmt` column; grouped
 * files have a `Commission Type` column. Filename hints help too.
 */
export function detectShlSchedule(fileName: string, headerRow: string[]): DetectedSchedule {
  const headers = headerRow.map(h => h.trim().toLowerCase());
  const hasCommAmt = headers.includes('commamt');
  const hasCommType = headers.includes('commission type');
  if (hasCommType) return 'grouped';
  if (hasCommAmt) return 'trail';
  const f = fileName.toLowerCase();
  if (f.includes('grouped')) return 'grouped';
  if (f.includes('trail_')) return 'trail';
  return 'unknown';
}

export function parseShlCsv(fileName: string, text: string): ShlLine[] {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  const headerLc = headers.map(h => h.toLowerCase());
  const scheduleType = detectShlSchedule(fileName, headers);
  if (scheduleType === 'unknown') return [];

  const data = rows.slice(1).filter(r => {
    const first = (r[0] ?? '').trim();
    if (!first) return false;
    if (first.toLowerCase().startsWith('total')) return false;
    return true;
  });

  const lines: ShlLine[] = [];

  if (scheduleType === 'trail') {
    const commIdx = headerLc.indexOf('commamt');
    const dateIdx = headerLc.indexOf('advancedate');
    for (const r of data) {
      const amt = parseDollar(r[commIdx]);
      if (amt === 0) continue;
      const d = dateIdx !== -1 ? parseFlexibleDate(r[dateIdx]) : null;
      lines.push({
        scheduleType: 'trail',
        fileName,
        paymentDate: d ? isoDate(d) : null,
        commissionType: 'TRAIL',
        amount: amt,
      });
    }
  } else {
    const typeIdx = headerLc.indexOf('commission type');
    const amtIdx = headerLc.indexOf('commission amount');
    const paidIdx = headerLc.indexOf('amount paid');
    const useIdx = paidIdx !== -1 ? paidIdx : amtIdx;
    const dateIdx = headerLc.indexOf('advanced date');
    for (const r of data) {
      const amt = parseDollar(r[useIdx]);
      if (amt === 0) continue;
      const t = String(r[typeIdx] ?? '').trim().toUpperCase();
      const commissionType: ShlLine['commissionType'] =
        t === 'UPFRONT' ? 'UPFRONT' : t === 'TRAIL' ? 'TRAIL' : 'OTHER';
      const d = dateIdx !== -1 ? parseFlexibleDate(r[dateIdx]) : null;
      lines.push({
        scheduleType: 'grouped',
        fileName,
        paymentDate: d ? isoDate(d) : null,
        commissionType,
        amount: amt,
      });
    }
  }

  return lines;
}

/** Filter SHL lines to a fortnight window — date-aware, but lines with no
 *  date fall through to the schedule-level window (caller decides). */
export function shlInWindow(lines: ShlLine[], startIso: string, endIso: string): ShlLine[] {
  return lines.filter(l => {
    if (!l.paymentDate) return true;
    return l.paymentDate >= startIso && l.paymentDate <= endIso;
  });
}

/** Aggregate SHL lines into upfront / trail / other totals. */
export function shlTotals(lines: ShlLine[]): { upfront: number; trail: number; other: number } {
  let upfront = 0, trail = 0, other = 0;
  for (const l of lines) {
    if (l.commissionType === 'UPFRONT') upfront += l.amount;
    else if (l.commissionType === 'TRAIL') trail += l.amount;
    else other += l.amount;
  }
  return { upfront, trail, other };
}
