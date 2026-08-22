'use client';

import { localeToBcp47 } from '@myclash/time';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';

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
  const { locale, t } = useI18n();
  const apiUrl = getPublicApiUrl();
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
    void Promise.all([
      apiRequest<DataQualityScan[]>(apiUrl, '/api/v1/admin/data-quality/scans'),
      apiRequest<DataQualityFinding[]>(apiUrl, '/api/v1/admin/data-quality/findings'),
    ])
      .then(([scanRes, findingRes]) => {
        if (scanRes.ok && findingRes.ok) {
          setScans(scanRes.data);
          setFindings(findingRes.data);
          setError(null);
          return;
        }
        const failed = scanRes.ok ? findingRes : scanRes;
        if (failed.ok) return;
        const message = failureMessage(failed, t, t('admin.dataQuality.loadError'));
        if (message) setError(message);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    const controller = new AbortController();

    void Promise.all([
      apiRequest<DataQualityScan[]>(apiUrl, '/api/v1/admin/data-quality/scans', {
        signal: controller.signal,
      }),
      apiRequest<DataQualityFinding[]>(apiUrl, '/api/v1/admin/data-quality/findings', {
        signal: controller.signal,
      }),
    ])
      .then(([scanRes, findingRes]) => {
        if (scanRes.ok && findingRes.ok) {
          setScans(scanRes.data);
          setFindings(findingRes.data);
          setError(null);
          return;
        }
        const failed = scanRes.ok ? findingRes : scanRes;
        // No message is the unmount.
        if (failed.ok) return;
        const message = failureMessage(failed, t, t('admin.dataQuality.loadError'));
        if (message) setError(message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [apiUrl, t]);

  async function runScan(mode: 'ai' | 'deterministic') {
    setScanning(true);
    setError(null);
    const r = await apiRequest(apiUrl, '/api/v1/admin/data-quality/scans', {
      method: 'POST',
      body: { mode },
    });
    setScanning(false);
    if (!r.ok) {
      const message = failureMessage(r, t, t('admin.dataQuality.scanError'));
      if (message) setError(message);
      return;
    }
    loadData();
  }

  async function updateFindingStatus(id: string, status: FindingStatus) {
    const r = await apiRequest<DataQualityFinding>(
      apiUrl,
      `/api/v1/admin/data-quality/findings/${id}`,
      { method: 'PATCH', body: { status } },
    );
    if (!r.ok) {
      const message = failureMessage(r, t, t('admin.dataQuality.updateError'));
      if (message) setError(message);
      return;
    }
    const updated = r.data;
    setFindings((current) => current.map((finding) => (finding.id === id ? updated : finding)));
  }

  return (
    <main className="mx-auto max-w-[110rem] px-6 py-8 lg:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl">
            {t('admin.dataQuality.title')}
          </h1>
          <p className="text-muted text-sm mt-1">{t('admin.dataQuality.description')}</p>
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
              className="bg-strong hover:opacity-90 disabled:opacity-50 text-strong-foreground font-semibold py-2 px-4 rounded-md text-sm"
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
              className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-md text-sm"
            >
              {scanning ? t('admin.dataQuality.scanning') : t('admin.dataQuality.runAi')}
            </button>
          </div>
          <p className="text-xs text-muted">{t('admin.dataQuality.cronHint')}</p>
        </div>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-md px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        {scans.slice(0, 3).map((scan) => (
          <article key={scan.id} className="rounded-lg border border-border p-4">
            <div className="text-xs uppercase text-muted">{scan.status}</div>
            <div className="mt-2 text-lg font-semibold">{scan.finding_count}</div>
            <div className="text-sm text-muted">
              {t('admin.dataQuality.findingsFromCandidates', {
                count: scan.candidate_count,
              })}
            </div>
            <div className="mt-2 text-xs text-muted">
              {new Date(scan.started_at).toLocaleString(localeToBcp47(locale))}
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
        <p className="text-muted text-sm">{t('common.loading')}</p>
      ) : filteredFindings.length === 0 ? (
        <p className="text-muted text-sm">{t('admin.dataQuality.empty')}</p>
      ) : (
        <div className="grid gap-4">
          {filteredFindings.map((finding) => (
            <article key={finding.id} className="rounded-lg border border-border p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={severityClass(finding.severity)}>{finding.severity}</span>
                    <span className="rounded-full bg-background px-2 py-0.5 text-xs text-foreground-secondary">
                      {finding.finding_type}
                    </span>
                    <span className="text-xs text-muted">
                      {Math.round(Number(finding.confidence) * 100)}%
                    </span>
                  </div>
                  <h2 className="mt-3 font-display font-semibold text-lg sm:text-xl text-foreground">
                    {finding.ai_summary}
                  </h2>
                  <p className="mt-2 text-sm text-foreground-secondary">
                    {finding.recommended_action}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={targetHref(finding)}
                    className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background"
                  >
                    {t('admin.dataQuality.openTarget')}
                  </Link>
                  {finding.status !== 'dismissed' && (
                    <button
                      type="button"
                      onClick={() => {
                        void updateFindingStatus(finding.id, 'dismissed');
                      }}
                      className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background"
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
                      className="rounded-md bg-strong px-3 py-1.5 text-sm font-semibold text-strong-foreground hover:opacity-90"
                    >
                      {t('admin.dataQuality.markResolved')}
                    </button>
                  )}
                </div>
              </div>
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-foreground-secondary">
                  {t('admin.dataQuality.evidence')}
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-strong p-3 text-xs text-strong-foreground">
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
  const { t } = useI18n();

  return (
    <label className="text-sm text-foreground-secondary">
      <span className="mb-1 block">{props.label}</span>
      <select
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
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
