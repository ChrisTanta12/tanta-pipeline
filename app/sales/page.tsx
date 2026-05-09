'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ExpiringPreApprovalsResponse,
  FunnelResponse,
  KsAttachResponse,
  LeadsResponse,
  LostResponse,
  ScorecardResponse,
  SourceMixResponse,
  StaleLeadsResponse,
  TargetsResponse,
} from '../lib/sales/types';

type LatestDigest = {
  cycleStart: string;
  cycleEnd: string;
  generatedAt: string;
  markdown: string;
};

type AllData = {
  scorecard: ScorecardResponse;
  leads: LeadsResponse;
  funnel: FunnelResponse;
  stale: StaleLeadsResponse;
  expiring: ExpiringPreApprovalsResponse;
  sourceMix: SourceMixResponse;
  lost: LostResponse;
  ksAttach: KsAttachResponse;
  targets: TargetsResponse;
  latestDigest: LatestDigest | null;
};

const STATUS_COLOR: Record<string, string> = {
  'on-track':  'text-green-600',
  'at-risk':   'text-amber-600',
  'off-track': 'text-red-600',
  'no-target': 'text-gray-500',
};
const STATUS_DOT: Record<string, string> = {
  'on-track':  'bg-green-500',
  'at-risk':   'bg-amber-500',
  'off-track': 'bg-red-500',
  'no-target': 'bg-gray-400',
};

export default function SalesPage() {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [data, setData] = useState<AllData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setError(null);
    const endpoints = [
      '/api/sales/scorecard',
      '/api/sales/leads?window=week',
      '/api/sales/funnel?window=90',
      '/api/sales/stale?days=14',
      '/api/sales/expiring-preapprovals?days=30',
      '/api/sales/source-mix?window=90',
      '/api/sales/lost?window=90',
      '/api/sales/ks-attach?window=90',
      '/api/sales/targets',
      '/api/sales/latest-digest',
    ];
    const responses = await Promise.all(
      endpoints.map((u) => fetch(u, { cache: 'no-store' })),
    );
    const auth = responses.find((r) => r.status === 401);
    if (auth) { setUnlocked(false); return; }
    const fail = responses.find((r) => !r.ok);
    if (fail) { setError(`Server returned ${fail.status} for ${fail.url}`); return; }
    const [scorecard, leads, funnel, stale, expiring, sourceMix, lost, ksAttach, targets, latestDigestPayload] =
      await Promise.all(responses.map((r) => r.json()));
    setData({
      scorecard, leads, funnel, stale, expiring, sourceMix, lost, ksAttach, targets,
      latestDigest: latestDigestPayload?.digest ?? null,
    });
    setUnlocked(true);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (unlocked === null) return <div className="p-12 text-gray-500">Loading…</div>;
  if (!unlocked) return <PinGate onUnlocked={fetchAll} />;
  if (error) return <div className="p-12 text-red-600">{error}</div>;
  if (!data) return <div className="p-12 text-gray-500">Loading data…</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header generatedAt={data.scorecard.generatedAt} onLogout={() => {
        fetch('/api/finance-unlock', { method: 'DELETE' }).then(() => setUnlocked(false));
      }} />
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <ScorecardBanner scorecard={data.scorecard} />
        <LeadInflow leads={data.leads} />
        <Funnel funnel={data.funnel} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <StalePanel stale={data.stale} />
          <ExpiringPanel expiring={data.expiring} />
        </div>
        <SourceMixPanel sourceMix={data.sourceMix} />
        <LostPanel lost={data.lost} />
        <KsAttachPanel ksAttach={data.ksAttach} />
        <TargetsEditor targets={data.targets} onSave={fetchAll} />
        <LatestDigestPanel digest={data.latestDigest} />
      </div>
    </div>
  );
}

// ============================================================================
// Sections
// ============================================================================

function Header({ generatedAt, onLogout }: { generatedAt: string; onLogout: () => void }) {
  return (
    <div className="bg-white border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
        <div>
          <div className="text-xs uppercase tracking-wider text-gray-500">Internal · Sales manager</div>
          <h1 className="text-2xl font-semibold mt-1">Sales</h1>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500">Generated {fmtDateTime(generatedAt)}</div>
          <button onClick={onLogout} className="text-xs text-gray-500 hover:text-gray-700 mt-1">Log out</button>
        </div>
      </div>
    </div>
  );
}

function ScorecardBanner({ scorecard }: { scorecard: ScorecardResponse }) {
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex justify-between items-baseline mb-4">
        <h2 className="text-lg font-semibold">Scorecard</h2>
        <div className="text-xs text-gray-500">
          Fortnight to {scorecard.windowEnd}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {scorecard.lines.map((l) => (
          <div key={l.metric} className="border border-gray-100 rounded p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2 h-2 rounded-full ${STATUS_DOT[l.status]}`} />
              <span className="text-xs text-gray-500">{l.metric}</span>
            </div>
            <div className={`text-2xl font-bold ${STATUS_COLOR[l.status]}`}>
              {l.actual}
              {l.unit === '%' ? '%' : ''}
            </div>
            {l.target != null && (
              <div className="text-xs text-gray-500 mt-1">
                target {l.target}{l.unit === '%' ? '%' : ''}
              </div>
            )}
          </div>
        ))}
      </div>
      {scorecard.alerts.length > 0 && (
        <div className="mt-4 space-y-1">
          {scorecard.alerts.map((a, i) => (
            <div key={i} className={`text-sm ${
              a.severity === 'red' ? 'text-red-700' :
              a.severity === 'warn' ? 'text-amber-700' : 'text-gray-700'
            }`}>
              <strong>{a.title}</strong>{a.detail ? ` — ${a.detail}` : ''}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LeadInflow({ leads }: { leads: LeadsResponse }) {
  const max = Math.max(1, ...leads.trend.map((t) => t.count));
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex justify-between items-baseline mb-4">
        <h2 className="text-lg font-semibold">New leads — {leads.total} this {leads.window}</h2>
        <div className="text-xs text-gray-500">{leads.windowStart} → {leads.windowEnd}</div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div className="text-xs text-gray-500 mb-2">By source</div>
          <table className="w-full text-sm">
            <tbody>
              {leads.bySource.map((s) => (
                <tr key={s.source} className="border-b border-gray-100">
                  <td className="py-1">{s.source}</td>
                  <td className="py-1 text-right font-mono">{s.count}</td>
                </tr>
              ))}
              {leads.bySource.length === 0 && (
                <tr><td className="py-1 text-gray-400">No leads in window</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-2">4-{leads.window} trend</div>
          <div className="space-y-1">
            {leads.trend.map((t) => (
              <div key={t.periodStart} className="flex items-center gap-2 text-sm">
                <div className="w-32 text-xs text-gray-600">{t.periodStart}</div>
                <div className="flex-1 bg-gray-100 h-5 rounded">
                  <div
                    className="bg-blue-500 h-5 rounded"
                    style={{ width: `${(t.count / max) * 100}%` }}
                  />
                </div>
                <div className="w-8 text-right font-mono text-sm">{t.count}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Funnel({ funnel }: { funnel: FunnelResponse }) {
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex justify-between items-baseline mb-4">
        <h2 className="text-lg font-semibold">Funnel</h2>
        <div className="text-xs text-gray-500">last {funnel.windowDays} days</div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 mb-6">
        {funnel.current.map((b) => (
          <div key={b.bucket} className="border border-gray-100 rounded p-2">
            <div className="text-xs text-gray-500">{b.bucket}</div>
            <div className="text-xl font-bold">{b.count}</div>
            <div className="text-xs text-gray-500">{fmtCurrency(b.value)}</div>
          </div>
        ))}
      </div>
      <div className="text-xs text-gray-500 mb-2">Cohort conversion (created in window)</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
            <th className="py-1">Transition</th>
            <th className="py-1 text-right">From</th>
            <th className="py-1 text-right">To</th>
            <th className="py-1 text-right">Conversion</th>
          </tr>
        </thead>
        <tbody>
          {funnel.transitions.map((t) => (
            <tr key={`${t.from}>${t.to}`} className="border-b border-gray-100">
              <td className="py-1">{t.from} → {t.to}</td>
              <td className="py-1 text-right font-mono">{t.fromCount}</td>
              <td className="py-1 text-right font-mono">{t.toCount}</td>
              <td className="py-1 text-right font-mono">{t.conversionPct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function StalePanel({ stale }: { stale: StaleLeadsResponse }) {
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-lg font-semibold mb-1">Stale leads</h2>
      <div className="text-xs text-gray-500 mb-4">{stale.total} {'>'} {stale.thresholdDays} days in stage</div>
      {stale.byBucket.length === 0 ? (
        <div className="text-sm text-gray-400">No stale leads.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
              <th className="py-1">Bucket</th>
              <th className="py-1">Client</th>
              <th className="py-1 text-right">Days</th>
            </tr>
          </thead>
          <tbody>
            {stale.byBucket.flatMap((b) =>
              b.leads.slice(0, 3).map((l) => (
                <tr key={l.opportunityId} className="border-b border-gray-100">
                  <td className="py-1 text-xs text-gray-600">{b.bucket}</td>
                  <td className="py-1">{l.profileName}</td>
                  <td className="py-1 text-right font-mono">{l.daysInStage}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ExpiringPanel({ expiring }: { expiring: ExpiringPreApprovalsResponse }) {
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-lg font-semibold mb-1">Pre-approvals expiring</h2>
      <div className="text-xs text-gray-500 mb-4">Next {expiring.withinDays} days · {expiring.total} total</div>
      {expiring.expirations.length === 0 ? (
        <div className="text-sm text-gray-400">None.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
              <th className="py-1">Client</th>
              <th className="py-1">Lender</th>
              <th className="py-1 text-right">Days</th>
            </tr>
          </thead>
          <tbody>
            {expiring.expirations.slice(0, 8).map((e) => (
              <tr key={e.opportunityId} className="border-b border-gray-100">
                <td className="py-1">{e.profileName}</td>
                <td className="py-1 text-xs text-gray-600">{e.lender}</td>
                <td className="py-1 text-right font-mono">{e.daysUntilExpiry}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function SourceMixPanel({ sourceMix }: { sourceMix: SourceMixResponse }) {
  const total = Math.max(1, sourceMix.total);
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex justify-between items-baseline mb-4">
        <h2 className="text-lg font-semibold">Source mix</h2>
        <div className="text-xs text-gray-500">last {sourceMix.windowDays} days</div>
      </div>
      {sourceMix.concentrationFlag && (
        <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
          ⚠️ <strong>{sourceMix.bySource[0]?.source}</strong> = {sourceMix.topSourcePct}% of leads — above {sourceMix.concentrationCeilingPct}% ceiling.
        </div>
      )}
      <table className="w-full text-sm">
        <tbody>
          {sourceMix.bySource.map((s) => (
            <tr key={s.source} className="border-b border-gray-100">
              <td className="py-1 w-1/3">{s.source}</td>
              <td className="py-1">
                <div className="bg-gray-100 h-4 rounded">
                  <div className="bg-blue-500 h-4 rounded" style={{ width: `${(s.count / total) * 100}%` }} />
                </div>
              </td>
              <td className="py-1 text-right font-mono w-12">{s.count}</td>
              <td className="py-1 text-right text-xs text-gray-500 w-12">{Math.round((s.count / total) * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function LostPanel({ lost }: { lost: LostResponse }) {
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex justify-between items-baseline mb-4">
        <h2 className="text-lg font-semibold">Lost deals — by stage at loss</h2>
        <div className="text-xs text-gray-500">last {lost.windowDays} days · {lost.total} total</div>
      </div>
      {lost.byStageAtLoss.length === 0 ? (
        <div className="text-sm text-gray-400">None.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
              <th className="py-1">Stage at loss</th>
              <th className="py-1 text-right">Count</th>
              <th className="py-1 text-right">Total value</th>
            </tr>
          </thead>
          <tbody>
            {lost.byStageAtLoss.map((b) => (
              <tr key={b.stageAtLoss} className="border-b border-gray-100">
                <td className="py-1">{b.stageAtLoss}</td>
                <td className="py-1 text-right font-mono">{b.count}</td>
                <td className="py-1 text-right font-mono">{fmtCurrency(b.totalValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function KsAttachPanel({ ksAttach }: { ksAttach: KsAttachResponse }) {
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex justify-between items-baseline mb-4">
        <h2 className="text-lg font-semibold">KiwiSaver attach</h2>
        <div className="text-xs text-gray-500">last {ksAttach.windowDays} days</div>
      </div>
      <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
        <div>
          <div className="text-xs text-gray-500">Settled mortgages</div>
          <div className="text-2xl font-bold">{ksAttach.settledMortgages}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">KS conversions</div>
          <div className="text-2xl font-bold">{ksAttach.ksConversions}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Attach rate</div>
          <div className="text-2xl font-bold">{ksAttach.attachPct}%</div>
        </div>
      </div>
      {ksAttach.candidates.length > 0 && (
        <>
          <div className="text-xs text-gray-500 mb-2">Cross-sell candidates (no KS yet)</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="py-1">Client</th>
                <th className="py-1">Settled</th>
              </tr>
            </thead>
            <tbody>
              {ksAttach.candidates.slice(0, 10).map((c) => (
                <tr key={c.profileId} className="border-b border-gray-100">
                  <td className="py-1">{c.profileName}</td>
                  <td className="py-1 text-xs text-gray-600">{c.mortgageSettledDate ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function TargetsEditor({ targets, onSave }: { targets: TargetsResponse; onSave: () => void }) {
  const [draft, setDraft] = useState(() => ({
    settlementsPerFortnight: targets.current.settlementsPerFortnight ?? targets.proposed.settlementsPerFortnight ?? 0,
    newLeadsPerWeek: targets.current.newLeadsPerWeek ?? targets.proposed.newLeadsPerWeek ?? 0,
    ksAttachPct: targets.current.ksAttachPct ?? targets.proposed.ksAttachPct ?? 0,
    sourceConcentrationCeilingPct: targets.current.sourceConcentrationCeilingPct ?? targets.proposed.sourceConcentrationCeilingPct ?? 70,
  }));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/sales/targets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets: draft, updatedBy: 'manual' }),
      });
      if (res.ok) {
        setSavedAt(new Date().toLocaleTimeString());
        onSave();
      }
    } finally { setSaving(false); }
  }, [draft, onSave]);

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-lg font-semibold mb-1">Targets</h2>
      <div className="text-xs text-gray-500 mb-4">
        Last updated: {targets.updatedAt ? fmtDateTime(targets.updatedAt) : '—'}
        {targets.updatedBy ? ` (${targets.updatedBy})` : ''}
        {' · proposed: '}
        {targets.proposed.settlementsPerFortnight} settlements/fortnight,{' '}
        {targets.proposed.newLeadsPerWeek} leads/wk,{' '}
        {targets.proposed.ksAttachPct}% KS,{' '}
        {targets.proposed.sourceConcentrationCeilingPct}% ceiling
      </div>
      <form onSubmit={submit} className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumberField label="Settlements / fortnight" value={draft.settlementsPerFortnight}
          onChange={(v) => setDraft({ ...draft, settlementsPerFortnight: v })} />
        <NumberField label="New leads / week" value={draft.newLeadsPerWeek}
          onChange={(v) => setDraft({ ...draft, newLeadsPerWeek: v })} />
        <NumberField label="KS attach %" value={draft.ksAttachPct}
          onChange={(v) => setDraft({ ...draft, ksAttachPct: v })} />
        <NumberField label="Source ceiling %" value={draft.sourceConcentrationCeilingPct}
          onChange={(v) => setDraft({ ...draft, sourceConcentrationCeilingPct: v })} />
        <div className="col-span-full flex items-center gap-3 mt-2">
          <button type="submit" disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save targets'}
          </button>
          {savedAt && <span className="text-xs text-green-600">Saved {savedAt}</span>}
        </div>
      </form>
    </section>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block text-sm">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono" />
    </label>
  );
}

function LatestDigestPanel({ digest }: { digest: LatestDigest | null }) {
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex justify-between items-baseline mb-4">
        <h2 className="text-lg font-semibold">Latest digest</h2>
        <div className="text-xs text-gray-500">
          {digest ? `${digest.cycleStart} → ${digest.cycleEnd}` : 'No digest yet'}
        </div>
      </div>
      {digest ? (
        <pre className="bg-gray-50 border border-gray-100 rounded p-4 text-sm whitespace-pre-wrap font-sans">
          {digest.markdown}
        </pre>
      ) : (
        <div className="text-sm text-gray-500">
          The first digest will be generated by the weekly cron (Mondays 7am NZ).
          You can also fetch on demand from <code className="bg-gray-100 px-1 rounded">/api/sales/digest</code>.
        </div>
      )}
    </section>
  );
}

function PinGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true); setErr(null);
    try {
      const res = await fetch('/api/finance-unlock', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }),
      });
      if (res.ok) onUnlocked();
      else if (res.status === 401) setErr('Incorrect PIN');
      else setErr(`Server returned ${res.status}`);
    } finally { setSubmitting(false); }
  }, [pin, onUnlocked]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 w-80 space-y-4">
        <div className="text-xs uppercase tracking-wider text-gray-500">Internal · Sales</div>
        <h1 className="text-xl font-semibold">Enter PIN</h1>
        <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus
          placeholder="••••" className="w-full border border-gray-300 rounded px-3 py-2" />
        {err && <div className="text-sm text-red-600">{err}</div>}
        <button type="submit" disabled={submitting || !pin}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">
          {submitting ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}

// ============================================================================
// Format helpers
// ============================================================================

function fmtCurrency(v: number): string {
  if (!v) return '$0';
  if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(1) + 'm';
  if (v >= 1_000) return '$' + (v / 1_000).toFixed(0) + 'k';
  return '$' + Math.round(v).toLocaleString('en-NZ');
}

function fmtDateTime(s: string): string {
  try {
    return new Date(s).toLocaleString('en-NZ', {
      timeZone: 'Pacific/Auckland', dateStyle: 'medium', timeStyle: 'short',
    });
  } catch { return s; }
}
