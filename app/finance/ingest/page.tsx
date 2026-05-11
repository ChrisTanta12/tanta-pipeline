'use client';

import '../styles.css';
import './ingest.css';
import { useCallback, useRef, useState } from 'react';
import type { IngestPreview } from '@/app/lib/finance-ingest/types';

/* ============================================================================
   /finance/ingest — drop-in ingest for the fortnightly catch-up
   - Drop bank CSVs + KAN xlsx + SHL CSVs onto the drop zone
   - Optional manual override of the fortnight window
   - POST to /api/finance-ingest/preview, render the resulting CycleRow
   - User confirms → POST to /api/finance-ingest/commit
   ============================================================================ */

type Stage = 'idle' | 'uploading' | 'previewed' | 'committing' | 'committed' | 'error';

const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString('en-NZ');
const fmtMoneyCents = (n: number) =>
  '$' + n.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function IngestPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [cycleStartDate, setCycleStartDate] = useState('');
  const [cycleEndDate, setCycleEndDate] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<IngestPreview | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const onPickFiles = useCallback((picked: FileList | null) => {
    if (!picked) return;
    setFiles(prev => {
      const next = [...prev];
      for (const f of Array.from(picked)) {
        if (!next.find(x => x.name === f.name && x.size === f.size)) next.push(f);
      }
      return next;
    });
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    onPickFiles(e.dataTransfer.files);
  }, [onPickFiles]);

  const removeFile = (name: string) => setFiles(prev => prev.filter(f => f.name !== name));
  const reset = () => {
    setFiles([]); setPreview(null); setError(null); setStage('idle');
    setCycleStartDate(''); setCycleEndDate('');
  };

  const submitPreview = useCallback(async () => {
    if (files.length === 0) return;
    setStage('uploading'); setError(null);
    const form = new FormData();
    for (const f of files) form.append('files', f);
    if (cycleStartDate) form.append('cycleStartDate', cycleStartDate);
    if (cycleEndDate) form.append('cycleEndDate', cycleEndDate);

    try {
      const res = await fetch('/api/finance-ingest/preview', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Server returned ${res.status}`); setStage('error');
        return;
      }
      setPreview(json as IngestPreview); setStage('previewed');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); setStage('error');
    }
  }, [files, cycleStartDate, cycleEndDate]);

  const commit = useCallback(async () => {
    if (!preview) return;
    setStage('committing'); setError(null);
    try {
      const res = await fetch('/api/finance-ingest/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cycleRow: preview.cycleRow }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Server returned ${res.status}`); setStage('error');
        return;
      }
      setStage('committed');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); setStage('error');
    }
  }, [preview]);

  return (
    <div className="tanta-finance-root">
      <header className="app-header">
        <div className="brand"><img src="/tanta-logo-white.svg" alt="Tanta" /></div>
        <div className="header-divider" />
        <div>
          <div className="crumb">Internal · Finance · Ingest</div>
          <div className="title">Drop fortnight inputs</div>
        </div>
        <div className="spacer" />
        <a href="/finance" className="logout">← Back to dashboard</a>
      </header>

      <div className="page ingest-page">
        {/* ─── Drop zone ─── */}
        <section className="ingest-section">
          <div className="section-head">
            <div>
              <div className="eyebrow">Step 1 · Files</div>
              <h2>Drop bank CSVs, KAN xlsx, SHL CSVs</h2>
            </div>
            <div className="section-meta">
              {files.length === 0
                ? 'No files yet'
                : `${files.length} file${files.length === 1 ? '' : 's'} staged`}
            </div>
          </div>

          <div
            className={`drop-zone ${files.length > 0 ? 'has-files' : ''}`}
            onDragOver={e => { e.preventDefault(); }}
            onDrop={onDrop}
            onClick={() => fileInput.current?.click()}
          >
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".csv,.xlsx,.xls"
              style={{ display: 'none' }}
              onChange={e => onPickFiles(e.target.files)}
            />
            {files.length === 0 ? (
              <div className="dz-empty">
                <div className="dz-icon">↓</div>
                <div className="dz-title">Drop CSV / xlsx files here</div>
                <div className="dz-sub">or click to browse. Bank statements, KAN export, SHL schedules — any combination.</div>
              </div>
            ) : (
              <ul className="dz-list">
                {files.map(f => (
                  <li key={f.name + f.size} className="dz-file">
                    <span className="dz-file-name">{f.name}</span>
                    <span className="dz-file-size">{(f.size / 1024).toFixed(1)} KB</span>
                    <button
                      type="button"
                      className="dz-file-remove"
                      onClick={e => { e.stopPropagation(); removeFile(f.name); }}
                      aria-label="Remove file"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ─── Window override ─── */}
        <section className="ingest-section">
          <div className="section-head">
            <div>
              <div className="eyebrow">Step 2 · Window (optional)</div>
              <h2>Fortnight start &amp; end dates</h2>
            </div>
            <div className="section-meta">Leave blank to auto-detect (last cycle + 14 days)</div>
          </div>
          <div className="window-row">
            <label>
              <span>Start (cycle_start_date)</span>
              <input type="date" value={cycleStartDate} onChange={e => setCycleStartDate(e.target.value)} />
            </label>
            <label>
              <span>End (cycle_end_date)</span>
              <input type="date" value={cycleEndDate} onChange={e => setCycleEndDate(e.target.value)} />
            </label>
          </div>
        </section>

        {/* ─── Preview button ─── */}
        <section className="ingest-section">
          <div className="ingest-actions">
            <button
              type="button"
              className="btn primary"
              disabled={files.length === 0 || stage === 'uploading'}
              onClick={submitPreview}
            >
              {stage === 'uploading' ? 'Parsing…' : 'Preview fortnight →'}
            </button>
            {(stage === 'previewed' || stage === 'committed' || stage === 'error') && (
              <button type="button" className="btn ghost" onClick={reset}>Start over</button>
            )}
          </div>
          {error && <div className="ingest-error">⚠ {error}</div>}
        </section>

        {/* ─── Preview card ─── */}
        {preview && stage !== 'committed' && (
          <PreviewCard preview={preview} onCommit={commit} committing={stage === 'committing'} />
        )}

        {stage === 'committed' && (
          <div className="ingest-success">
            <div className="ok-tag">✓ Committed</div>
            <h3>Fortnight ending {preview?.cycleRow.cycleEndDate} upserted into finance_cycles.</h3>
            <p>
              Open <a href="/finance">the dashboard</a> to see the new fortnight in the picker.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
   Preview card — same skeleton as the AllocationsPanel on /finance
   ============================================================================ */
function PreviewCard({
  preview, onCommit, committing,
}: { preview: IngestPreview; onCommit: () => void; committing: boolean }) {
  const c = preview.cycleRow;
  const w = preview.window;
  const trailPct = c.tradingIncomeCash > 0 ? c.trailIncome / c.tradingIncomeCash : 0;
  const upfrontPct = c.tradingIncomeCash > 0 ? c.upfrontIncome / c.tradingIncomeCash : 0;
  const allocSum =
    c.allocationsPrescribed.opex +
    c.allocationsPrescribed.salaries +
    c.allocationsPrescribed.tax +
    c.allocationsPrescribed.profit;

  const sources = Object.entries(c.incomeBySource).map(([src, b]) => {
    const total = (b.trail ?? 0) + (b.upfront ?? 0) + (b.refix ?? 0) + (b.other ?? 0);
    return { src, total, trail: b.trail ?? 0, upfront: b.upfront ?? 0 };
  }).sort((a, b) => b.total - a.total);

  return (
    <section className="ingest-section preview-card">
      <div className="section-head">
        <div>
          <div className="eyebrow">Step 3 · Preview</div>
          <h2>Fortnight ending {c.cycleEndDate}</h2>
        </div>
        <div className="section-meta">
          {w.inferred ? 'Window auto-detected' : 'Window from manual override'} · {c.quarter}
        </div>
      </div>

      {/* Files parsed */}
      <div className="preview-files">
        {preview.filesParsed.bankCsvs.map(b => (
          <span key={b.fileName} className="pill upfront">
            <span className="dot" />Bank · {b.account.replace(/_/g, ' ')} · {b.lineCount} lines
          </span>
        ))}
        {preview.filesParsed.kanXlsx && (
          <span className="pill trail">
            <span className="dot" />KAN · {preview.filesParsed.kanXlsx.lineCount} lines · {preview.filesParsed.kanXlsx.inWindow} in window
          </span>
        )}
        {preview.filesParsed.shlCsvs.map(s => (
          <span key={s.fileName} className="pill trail">
            <span className="dot" />SHL · {s.scheduleType} · {s.lineCount} lines
          </span>
        ))}
      </div>

      {/* Income */}
      <div className="preview-block">
        <div className="pb-eyebrow">Trading income</div>
        <div className="pb-big tnum">{fmtMoneyCents(c.tradingIncomeCash)}</div>
        <div className="pb-pills">
          <span className="pill trail">
            <span className="dot" />Trail {fmtMoney(c.trailIncome)} · {(trailPct * 100).toFixed(1)}%
          </span>
          <span className="pill upfront">
            <span className="dot" />Upfront {fmtMoney(c.upfrontIncome)} · {(upfrontPct * 100).toFixed(1)}%
          </span>
        </div>
        {sources.length > 0 && (
          <table className="preview-table tnum">
            <thead>
              <tr><th>Source</th><th>Trail</th><th>Upfront</th><th>Total</th></tr>
            </thead>
            <tbody>
              {sources.map(s => (
                <tr key={s.src}>
                  <td>{s.src}</td>
                  <td className="num">{s.trail > 0 ? fmtMoney(s.trail) : '—'}</td>
                  <td className="num">{s.upfront > 0 ? fmtMoney(s.upfront) : '—'}</td>
                  <td className="num">{fmtMoney(s.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Prescribed allocations */}
      <div className="preview-block">
        <div className="pb-eyebrow">Prescribed allocations (49/45/4/2)</div>
        <table className="preview-table tnum">
          <thead>
            <tr><th>Bucket</th><th>Prescribed</th><th>Already moved</th></tr>
          </thead>
          <tbody>
            <tr><td>Opex (49%)</td><td className="num">{fmtMoneyCents(c.allocationsPrescribed.opex)}</td><td className="num">{fmtMoneyCents(c.allocationsActual.opex)}</td></tr>
            <tr><td>Drawings (45%)</td><td className="num">{fmtMoneyCents(c.allocationsPrescribed.salaries)}</td><td className="num">{fmtMoneyCents(c.allocationsActual.salaries)}</td></tr>
            <tr><td>Tax (4%)</td><td className="num">{fmtMoneyCents(c.allocationsPrescribed.tax)}</td><td className="num">{fmtMoneyCents(c.allocationsActual.tax)}</td></tr>
            <tr><td>Profit (2%)</td><td className="num">{fmtMoneyCents(c.allocationsPrescribed.profit)}</td><td className="num">{fmtMoneyCents(c.allocationsActual.profit)}</td></tr>
          </tbody>
          <tfoot>
            <tr><td>Total</td><td className="num">{fmtMoneyCents(allocSum)}</td><td className="num">{fmtMoneyCents(c.allocationsActual.opex + c.allocationsActual.salaries + c.allocationsActual.tax + c.allocationsActual.profit)}</td></tr>
          </tfoot>
        </table>
      </div>

      {/* Opex + drawings */}
      <div className="preview-block">
        <div className="pb-eyebrow">True opex this fortnight</div>
        <div className="pb-big tnum">{fmtMoneyCents(c.trueOpex)}</div>
        {Object.keys(c.opexByCategory).length > 0 && (
          <ul className="preview-cat-list">
            {Object.entries(c.opexByCategory)
              .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
              .map(([k, v]) => (
                <li key={k}><span>{k}</span><span className="tnum">{fmtMoney(v ?? 0)}</span></li>
              ))}
          </ul>
        )}
        <div className="pb-rows" style={{ marginTop: 14 }}>
          <div><span>Drawings — Chris</span><span className="tnum">{fmtMoney(c.drawingsChris)}</span></div>
          <div><span>Drawings — Anthony</span><span className="tnum">{fmtMoney(c.drawingsAnthony)}</span></div>
        </div>
      </div>

      {/* Suspected capital */}
      {preview.suspectedCapital.length > 0 && (
        <div className="preview-block preview-capital">
          <div className="pb-eyebrow capital">Suspected capital pass-throughs · review before commit</div>
          <ul className="preview-capital-list">
            {preview.suspectedCapital.map((s, i) => (
              <li key={i}>
                <span className="cap-date">{s.date}</span>
                <span className="cap-payee">{s.payee}</span>
                <span className="cap-reason">{s.reason}</span>
                <span className={`cap-amount tnum ${s.amount < 0 ? 'neg' : ''}`}>
                  {s.amount >= 0 ? '+' : '−'}{fmtMoney(Math.abs(s.amount))}
                </span>
              </li>
            ))}
          </ul>
          <p className="capital-note">
            These lines are excluded from trading income / opex by classification. Add them as capital movements manually if needed.
          </p>
        </div>
      )}

      {/* Flags */}
      {c.flags.length > 0 && (
        <div className="preview-block">
          <div className="pb-eyebrow">Flags</div>
          <ul className="preview-flags">
            {c.flags.map((f, i) => (
              <li key={i} className={`flag flag-${f.severity}`}>
                <strong>{f.title}</strong>
                <span>{f.body}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Commit */}
      <div className="ingest-actions" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <button
          type="button"
          className="btn primary"
          onClick={onCommit}
          disabled={committing}
        >
          {committing ? 'Committing…' : `Commit fortnight ending ${c.cycleEndDate} →`}
        </button>
      </div>
    </section>
  );
}
