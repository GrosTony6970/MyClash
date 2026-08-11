'use client';

import { useCallback, useEffect, useState } from 'react';
import { localeToBcp47, type AppLocale } from '@myclash/time';
import { DataTable, DataTableCell, DataTableHead, DataTableRow } from '@myclash/ui';
import { useI18n } from '../../../src/i18n/I18nProvider';
import { getPublicApiUrl } from '@/lib/api-url';

type CiGateVerdict = 'passed' | 'failed' | 'skipped' | 'cancelled' | 'not_reported';
type Translate = (key: string, params?: Record<string, string | number>) => string;

interface CiGateRow {
  job: string;
  step: string;
  verdict: CiGateVerdict;
}

interface CiRun {
  runNumber: number;
  sha: string;
  conclusion: string | null;
  createdAt: string;
  url: string;
}

interface CiHealthResponse {
  status: 'ok' | 'unavailable';
  checkedAt: string;
  repo: string;
  latestRun: CiRun | null;
  lastAllGreenRun: CiRun | null;
  gates: CiGateRow[];
  notReportedCount: number;
  rateLimitRemaining: number | null;
  authenticated: boolean;
  error?: string;
}

const EMPTY = '—';

function formatWhen(value: string, locale: AppLocale): string {
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return EMPTY;
  return new Intl.DateTimeFormat(localeToBcp47(locale), {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(ts));
}

// Explicit static t() calls (not template literals) so the i18n key-reference
// lint resolves every key in both EN and FR — same reason as HostInfoCard.
function verdictLabel(t: Translate, verdict: CiGateVerdict): string {
  switch (verdict) {
    case 'passed':
      return t('admin.systemVersions.ci.verdicts.passed');
    case 'failed':
      return t('admin.systemVersions.ci.verdicts.failed');
    case 'skipped':
      return t('admin.systemVersions.ci.verdicts.skipped');
    case 'cancelled':
      return t('admin.systemVersions.ci.verdicts.cancelled');
    default:
      return t('admin.systemVersions.ci.verdicts.notReported');
  }
}

/**
 * `not_reported` is styled as loudly as a failure on purpose: it is the state
 * that hid eight gates for six weeks, and it reads as innocuous unless the card
 * insists otherwise.
 */
function verdictClass(verdict: CiGateVerdict): string {
  switch (verdict) {
    case 'passed':
      return 'text-success';
    case 'failed':
      return 'text-danger';
    case 'not_reported':
      return 'text-danger font-semibold';
    default:
      return 'text-warning';
  }
}

export function CiHealthCard() {
  const apiUrl = getPublicApiUrl();
  const { t, locale } = useI18n();

  const [health, setHealth] = useState<CiHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHealth = useCallback(
    ({ signal, refresh = false }: { signal?: AbortSignal; refresh?: boolean } = {}) => {
      if (refresh) setRefreshing(true);

      fetch(`${apiUrl}/api/v1/admin/system/ci-health`, { credentials: 'include', signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(t('admin.systemVersions.ci.loadError'));
          const data = (await res.json()) as CiHealthResponse;
          setHealth(data);
          setError(null);
        })
        .catch((err: unknown) => {
          if (!(err instanceof DOMException && err.name === 'AbortError')) {
            setError(err instanceof Error ? err.message : t('admin.systemVersions.ci.loadError'));
          }
        })
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    },
    [apiUrl, t],
  );

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => loadHealth({ signal: controller.signal }));
    return () => {
      controller.abort();
    };
  }, [loadHealth]);

  const passed = health ? health.gates.filter((g) => g.verdict === 'passed').length : 0;

  return (
    <section className="border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-background flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
            {t('admin.systemVersions.ci.title')}
          </h2>
          <p className="text-muted text-xs mt-0.5">{t('admin.systemVersions.ci.description')}</p>
        </div>
        <button
          type="button"
          onClick={() => loadHealth({ refresh: true })}
          disabled={loading || refreshing}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
        >
          {refreshing
            ? t('admin.systemVersions.ci.refreshing')
            : t('admin.systemVersions.ci.refresh')}
        </button>
      </div>

      {error && (
        <div className="bg-danger/10 border-b border-danger/30 text-danger px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="px-4 py-4 text-sm text-muted">{t('admin.systemVersions.ci.loading')}</p>
      ) : health?.status === 'unavailable' ? (
        <p className="px-4 py-4 text-sm text-warning">
          {t('admin.systemVersions.ci.unavailable', {
            reason: health.error ?? EMPTY,
          })}
        </p>
      ) : health ? (
        <>
          {health.notReportedCount > 0 && (
            <div className="bg-danger/10 border-b border-danger/30 text-danger px-4 py-3 text-sm">
              {health.notReportedCount === 1
                ? t('admin.systemVersions.ci.notReportedWarning', {
                    count: health.notReportedCount,
                  })
                : t('admin.systemVersions.ci.notReportedWarningPlural', {
                    count: health.notReportedCount,
                  })}
            </div>
          )}

          <div className="overflow-x-auto">
            <DataTable className="min-w-[640px]">
              <DataTableHead>
                <DataTableCell as="th">{t('admin.systemVersions.ci.columns.gate')}</DataTableCell>
                <DataTableCell as="th">{t('admin.systemVersions.ci.columns.job')}</DataTableCell>
                <DataTableCell as="th">
                  {t('admin.systemVersions.ci.columns.verdict')}
                </DataTableCell>
              </DataTableHead>
              <tbody>
                {health.gates.map((gate) => (
                  <DataTableRow key={`${gate.job}/${gate.step}`}>
                    <DataTableCell className="text-foreground-secondary">{gate.step}</DataTableCell>
                    <DataTableCell className="text-muted whitespace-nowrap">
                      {gate.job}
                    </DataTableCell>
                    <DataTableCell className={`whitespace-nowrap ${verdictClass(gate.verdict)}`}>
                      {verdictLabel(t, gate.verdict)}
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </tbody>
            </DataTable>
          </div>

          <div className="border-t border-border px-4 py-2.5 text-xs text-muted space-y-1">
            <p>{t('admin.systemVersions.ci.summary', { passed, total: health.gates.length })}</p>
            {health.latestRun && (
              <p>
                <a
                  href={health.latestRun.url}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-foreground-secondary underline"
                >
                  {t('admin.systemVersions.ci.latestRun', {
                    run: health.latestRun.runNumber,
                    sha: health.latestRun.sha.slice(0, 8),
                    time: formatWhen(health.latestRun.createdAt, locale),
                  })}
                </a>
              </p>
            )}
            {/* Deliberately shown with its date. On a repo where one job stays red
                for months this is months behind HEAD, and its staleness is the
                honest signal — the per-gate table above is the real reading. */}
            <p>
              {health.lastAllGreenRun
                ? t('admin.systemVersions.ci.lastAllGreen', {
                    sha: health.lastAllGreenRun.sha.slice(0, 8),
                    time: formatWhen(health.lastAllGreenRun.createdAt, locale),
                  })
                : t('admin.systemVersions.ci.neverAllGreen')}
            </p>
            {health.rateLimitRemaining !== null && (
              <p>
                {health.authenticated
                  ? t('admin.systemVersions.ci.rateLimit', {
                      remaining: health.rateLimitRemaining,
                    })
                  : t('admin.systemVersions.ci.rateLimitAnon', {
                      remaining: health.rateLimitRemaining,
                    })}
              </p>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
