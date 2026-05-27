'use client';

import { t } from '@myclash/i18n';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type FindingStatus = 'open' | 'dismissed' | 'resolved';

interface DataQualityScan {
  id: string;
  status: string;
  candidate_count: number;
  finding_count: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

interface DataQualityFinding {
  id: string;
  finding_type: string;
  severity: string;
  confidence: number;
  status: FindingStatus;
  entity_ids: Record<string, string[]>;
  evidence_json: Record<string, unknown>;
  ai_summary: string;
  recommended_action: string;
  created_at: string;
}

const statusOptions = ['all', 'open', 'dismissed', 'resolved'] as const;
const severityOptions = ['all', 'low', 'medium', 'high', 'critical'] as const;
const typeOptions = [
  'all',
  'global_person_duplicate',
  'club_duplicate',
  'referee_unlinked',
  'identity_gap',
  'placeholder_name',
  'event_person_duplicate',
  'missing_field',
] as const;

export default function AdminDataQualityPage() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const [scans, setScans] = useState<DataQualityScan[]>([]);
  const [findings, setFindings] = useState<DataQualityFinding[]>([]);
  const [statusFilter, setStatusFilter] = useState<(typeof statusOptions)[number]>('open');
  const [severityFilter, setSeverityFilter] = useState<(typeof severityOptions)[number]>('all');
  const [typeFilter, setTypeFilter] = useState<(typeof typeOptions)[number]>('all');
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredFindings = useMemo(
    () =>
      findings.filter(
        (finding) =>
          (statusFilter === 'all' || finding.status === statusFilter) &&
          (severityFilter === 'all' || finding.severity === severityFilter) &&
          (typeFilter === 'all' || finding.finding_type === typeFilter),
      ),
    [findings, severityFilter, statusFilter, typeFilter],
  );

  function loadData() {
    setLoading(true);
    Promise.all([
      fetch(`${apiUrl}/api/v1/admin/data-quality/scans`, { credentials: 'include' }),
      fetch(`${apiUrl}/api/v1/admin/data-quality/findings`, { credentials: 'include' }),
    ])
      .then(async ([scanRes, findingRes]) => {
        if (!scanRes.ok || !findingRes.ok) throw new Error(t('admin.dataQuality.loadError'));
        setScans((await scanRes.json()) as DataQualityScan[]);
        setFindings((await findingRes.json()) as DataQualityFinding[]);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : t('admin.dataQuality.loadError'));
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      fetch(`${apiUrl}/api/v1/admin/data-quality/scans`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/admin/data-quality/findings`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([scanRes, findingRes]) => {
        if (!scanRes.ok || !findingRes.ok) throw new Error(t('admin.dataQuality.loadError'));
        setScans((await scanRes.json()) as DataQualityScan[]);
        setFindings((await findingRes.json()) as DataQualityFinding[]);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : t('admin.dataQuality.loadError'));
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [apiUrl]);

  async function runScan(mode: 'ai' | 'deterministic') {
    setScanning(true);
    setError(null);
    const res = await fetch(`${apiUrl}/api/v1/admin/data-quality/scans`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    setScanning(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      setError(body.message ?? t('admin.dataQuality.scanError'));
      return;
    }
    loadData();
  }

  async function updateFindingStatus(id: string, status: FindingStatus) {
    const res = await fetch(`${apiUrl}/api/v1/admin/data-quality/findings/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      setError(t('admin.dataQuality.updateError'));
      return;
    }
    const updated = (await res.json()) as DataQualityFinding;
    setFindings((current) => current.map((finding) => (finding.id === id ? updated : finding)));
  }

  return (
    <main className="p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('admin.dataQuality.title')}</h1>
          <p className="text-slate-500 text-sm mt-1">{t('admin.dataQuality.description')}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                void runScan('deterministic');
              }}
              disabled={scanning}
              title={t('admin.dataQuality.runDeterministicHint')}
              className="bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-md text-sm"
            >
              {scanning ? t('admin.dataQuality.scanning') : t('admin.dataQuality.runDeterministic')}
            </button>
            <button
              type="button"
              onClick={() => {
                void runScan('ai');
              }}
              disabled={scanning}
              title={t('admin.dataQuality.runAiHint')}
              className="bg-red-800 hover:bg-red-900 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-md text-sm"
            >
              {scanning ? t('admin.dataQuality.scanning') : t('admin.dataQuality.runAi')}
            </button>
          </div>
          <p className="text-xs text-slate-400">{t('admin.dataQuality.cronHint')}</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        {scans.slice(0, 3).map((scan) => (
          <article key={scan.id} className="rounded-lg border border-slate-200 p-4">
            <div className="text-xs uppercase text-slate-400">{scan.status}</div>
            <div className="mt-2 text-lg font-semibold">{scan.finding_count}</div>
            <div className="text-sm text-slate-500">
              {t('admin.dataQuality.findingsFromCandidates', {
                count: scan.candidate_count,
              })}
            </div>
            <div className="mt-2 text-xs text-slate-400">
              {new Date(scan.started_at).toLocaleString('fr-FR')}
            </div>
          </article>
        ))}
      </section>

      <section className="mb-4 flex flex-wrap gap-3">
        <FilterSelect
          label={t('admin.dataQuality.status')}
          value={statusFilter}
          options={statusOptions}
          onChange={(value) => setStatusFilter(value as (typeof statusOptions)[number])}
        />
        <FilterSelect
          label={t('admin.dataQuality.severity')}
          value={severityFilter}
          options={severityOptions}
          onChange={(value) => setSeverityFilter(value as (typeof severityOptions)[number])}
        />
        <FilterSelect
          label={t('admin.dataQuality.type')}
          value={typeFilter}
          options={typeOptions}
          onChange={(value) => setTypeFilter(value as (typeof typeOptions)[number])}
        />
      </section>

      {loading ? (
        <p className="text-slate-400 text-sm">{t('common.loading')}</p>
      ) : filteredFindings.length === 0 ? (
        <p className="text-slate-400 text-sm">{t('admin.dataQuality.empty')}</p>
      ) : (
        <div className="grid gap-4">
          {filteredFindings.map((finding) => (
            <article key={finding.id} className="rounded-lg border border-slate-200 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={severityClass(finding.severity)}>{finding.severity}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {finding.finding_type}
                    </span>
                    <span className="text-xs text-slate-400">
                      {Math.round(Number(finding.confidence) * 100)}%
                    </span>
                  </div>
                  <h2 className="mt-3 text-base font-semibold text-gray-950">
                    {finding.ai_summary}
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">{finding.recommended_action}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={targetHref(finding)}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
                  >
                    {t('admin.dataQuality.openTarget')}
                  </Link>
                  {finding.status !== 'dismissed' && (
                    <button
                      type="button"
                      onClick={() => {
                        void updateFindingStatus(finding.id, 'dismissed');
                      }}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
                    >
                      {t('actions.dismiss')}
                    </button>
                  )}
                  {finding.status !== 'resolved' && (
                    <button
                      type="button"
                      onClick={() => {
                        void updateFindingStatus(finding.id, 'resolved');
                      }}
                      className="rounded-md bg-gray-950 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800"
                    >
                      {t('admin.dataQuality.markResolved')}
                    </button>
                  )}
                </div>
              </div>
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-slate-600">
                  {t('admin.dataQuality.evidence')}
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-gray-950 p-3 text-xs text-slate-100">
                  {JSON.stringify(
                    { entityIds: finding.entity_ids, evidence: finding.evidence_json },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

function FilterSelect(props: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm text-slate-600">
      <span className="mb-1 block">{props.label}</span>
      <select
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/30"
      >
        {props.options.map((option) => (
          <option key={option} value={option}>
            {t(`admin.dataQuality.filterOptions.${option}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

function severityClass(severity: string): string {
  const base = 'rounded-full px-2 py-0.5 text-xs font-semibold';
  if (severity === 'critical') return `${base} bg-red-100 text-red-700`;
  if (severity === 'high') return `${base} bg-orange-100 text-orange-700`;
  if (severity === 'medium') return `${base} bg-yellow-100 text-yellow-700`;
  return `${base} bg-green-100 text-green-700`;
}

function targetHref(finding: DataQualityFinding): string {
  if (finding.finding_type === 'club_duplicate') {
    return '/admin/clubs';
  }
  return '/admin/fighters';
}
