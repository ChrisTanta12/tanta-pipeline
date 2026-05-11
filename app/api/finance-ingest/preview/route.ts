/**
 * POST /api/finance-ingest/preview
 *
 * Accepts a multipart upload of:
 *   - 0..N bank CSVs (any of: Tanta Income / Opex 8.1K / Expenses CC) — field name `files`
 *   - optional KAN xlsx — same `files` field, detected by extension
 *   - optional SHL CSVs — same `files` field, detected by header sniff
 *
 * Optional body fields:
 *   - cycleStartDate (ISO yyyy-mm-dd) — override
 *   - cycleEndDate   (ISO yyyy-mm-dd) — override
 *
 * Returns a JSON IngestPreview with the computed CycleRow + warnings +
 * suspected capital lines. Does NOT write to the DB — that's the commit
 * endpoint.
 *
 * Auth-gated via isFinanceUnlocked().
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { isFinanceUnlocked } from '@/app/lib/finance-auth';
import { getCurrentConfig } from '@/app/lib/finance-db';
import { parseBankCsv } from '@/app/lib/finance-ingest/bank';
import { parseKanXlsx } from '@/app/lib/finance-ingest/kan';
import { parseShlCsv, detectShlSchedule } from '@/app/lib/finance-ingest/shl';
import { composePreview, inferWindow } from '@/app/lib/finance-ingest/compose';
import { parseCSV } from '@/app/lib/finance-ingest/csv';
import type { BankAccount, BankLine, KanLine, ShlLine } from '@/app/lib/finance-ingest/types';

export const runtime = 'nodejs';   // we need Buffer / xlsx — not the edge runtime

async function latestCycleEndDate(): Promise<string | null> {
  const { rows } = await sql<{ cycle_end_date: string }>`
    SELECT cycle_end_date::text AS cycle_end_date
    FROM finance_cycles
    ORDER BY cycle_end_date DESC
    LIMIT 1
  `;
  return rows[0]?.cycle_end_date ?? null;
}

type FileMeta = { name: string; ext: string; text: string | null; buf: ArrayBuffer | null };

export async function POST(req: NextRequest) {
  if (!isFinanceUnlocked()) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 }); }

  const cycleStartDate = (form.get('cycleStartDate') as string | null) ?? undefined;
  const cycleEndDate   = (form.get('cycleEndDate')   as string | null) ?? undefined;

  const files: FileMeta[] = [];
  const entries = form.getAll('files');
  for (const e of entries) {
    if (!(e instanceof File)) continue;
    const name = e.name;
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'xlsx' || ext === 'xls') {
      files.push({ name, ext, text: null, buf: await e.arrayBuffer() });
    } else {
      files.push({ name, ext, text: await e.text(), buf: null });
    }
  }

  if (files.length === 0) {
    return NextResponse.json({ error: 'no files uploaded' }, { status: 400 });
  }

  /* ---------- Classify each file and parse ---------- */
  const bankByAccount = new Map<BankAccount, BankLine[]>();
  const bankCsvsMeta: { account: BankAccount; fileName: string; lineCount: number }[] = [];
  let kanLines: KanLine[] = [];
  let kanFileName: string | null = null;
  const shlLines: ShlLine[] = [];
  const shlMeta: { fileName: string; scheduleType: 'trail' | 'grouped'; lineCount: number; inWindow: number }[] = [];

  for (const f of files) {
    if (f.ext === 'xlsx' || f.ext === 'xls') {
      const lines = parseKanXlsx(f.buf!);
      if (lines.length > 0) {
        kanLines = kanLines.concat(lines);
        kanFileName = f.name;
      }
      continue;
    }
    if (f.ext === 'csv' && f.text) {
      // SHL or bank? Sniff headers.
      const rows = parseCSV(f.text);
      const headers = rows[0]?.map(h => h.trim().toLowerCase()) ?? [];
      const isBank = headers.includes('this party account') && headers.includes('payee');
      if (isBank) {
        const parsed = parseBankCsv(f.text);
        const cur = bankByAccount.get(parsed.account) ?? [];
        bankByAccount.set(parsed.account, cur.concat(parsed.lines));
        bankCsvsMeta.push({ account: parsed.account, fileName: f.name, lineCount: parsed.lines.length });
        continue;
      }
      const shlType = detectShlSchedule(f.name, rows[0] ?? []);
      if (shlType !== 'unknown') {
        const parsed = parseShlCsv(f.name, f.text);
        shlLines.push(...parsed);
        shlMeta.push({ fileName: f.name, scheduleType: shlType, lineCount: parsed.length, inWindow: 0 });
        continue;
      }
      // Unrecognised CSV — skip but tell the user
    }
  }

  /* ---------- Window inference ---------- */
  const allBank: BankLine[] = [];
  for (const v of bankByAccount.values()) allBank.push(...v);
  const lastEnd = await latestCycleEndDate();
  const window = inferWindow({
    override: { startIso: cycleStartDate, endIso: cycleEndDate },
    lastCycleEndIso: lastEnd,
    bankLines: allBank,
  });

  /* ---------- Config (for TAPs) ---------- */
  const config = await getCurrentConfig();
  if (!config) {
    return NextResponse.json({
      error: 'no active finance_config — run npm run finance:seed first',
    }, { status: 500 });
  }

  /* ---------- Compose ---------- */
  const preview = composePreview({
    window,
    taps: config.taps,
    bankByAccount: Array.from(bankByAccount.entries()).map(([account, lines]) => ({ account, lines })),
    kanLines,
    shlLines,
  });

  // Populate filesParsed meta (compose intentionally leaves this for the API
  // layer since it has the names).
  preview.filesParsed = {
    bankCsvs: bankCsvsMeta,
    kanXlsx: kanFileName
      ? {
          fileName: kanFileName,
          lineCount: kanLines.length,
          inWindow: kanLines.filter(l => l.paymentDate >= window.cycleStartDate && l.paymentDate <= window.cycleEndDate).length,
        }
      : null,
    shlCsvs: shlMeta.map(m => {
      const fileLines = shlLines.filter(l => l.fileName === m.fileName);
      const inWin = fileLines.filter(l => !l.paymentDate || (l.paymentDate >= window.cycleStartDate && l.paymentDate <= window.cycleEndDate)).length;
      return { ...m, inWindow: inWin };
    }),
  };

  return NextResponse.json(preview);
}
