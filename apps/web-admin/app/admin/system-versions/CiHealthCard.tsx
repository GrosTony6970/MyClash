'use client';

import { useCallback, useEffect, useState } from 'react';
import { localeToBcp47, type AppLocale } from '@myclash/time';
import { DataTable, DataTableCell, DataTableHead, DataTableRow } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
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

/** Fetch + refresh state, kept out of the component so it stays about layout. */
function useCiHealth(t: Translate) {
  const apiUrl = getPublicApiUrl();
  const [health, setHealth] = useState<CiHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    ({ signal, refresh = false }: { signal?: AbortSignal; refresh?: boolean } = {}) => {
      if (refresh) setRefreshing(true);

      void apiRequest<CiHealthResponse>(apiUrl, '/api/v1/admin/system/ci-health', { signal })
        .then((r) => {
          if (r.ok) {
            setHealth(r.data);
            setError(null);
            return;
          }
          // No message is the unmount, or the refresh that replaced this read.
          const message = failureMessage(r, t, t('admin.systemVersions.ci.loadError'));
          if (message) setError(message);
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
    void Promise.resolve().then(() => load({ signal: controller.signal }));
    return () => {
      controller.abort();
    };
  }, [load]);

  return { health, loading, refreshing, error, refresh: () => load({ refresh: true }) };
}

export function CiHealthCard() {
  const { t, locale } = useI18n();
  const { health, loading, refreshing, error, refresh } = useCiHealth(t);

  const passed = health ? health.gates.filter((g) => g.verdict === 'passed').length : 0;

  return (
    <section className="border border-border rounded-lg overflow-hidden">
      <CardHeader busy={loading || refreshing} refreshing={refreshing} onRefresh={refresh} t={t} />

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
          <NotReportedBanner count={health.notReportedCount} t={t} />
          <GateTable gates={health.gates} t={t} />
          <CardFooter health={health} passed={passed} locale={locale} t={t} />
        </>
      ) : null}
    </section>
  );
}

function CardHeader({
  busy,
  refreshing,
  onRefresh,
  t,
}: {
  busy: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  t: Translate;
}) {
  return (
    <div className="px-4 py-3 border-b border-border bg-background flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
          {t('admin.systemVersions.ci.title')}
        </h2>
        <p className="text-muted text-xs mt-0.5">{t('admin.systemVersions.ci.description')}</p>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={busy}
        className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
      >
        {refreshing
          ? t('admin.systemVersions.ci.refreshing')
          : t('admin.systemVersions.ci.refresh')}
      </button>
    </div>
  );
}

/**
 * The loudest thing on the card, because the condition it names is the quietest:
 * a gate that stops running leaves no row, no colour and no error.
 */
function NotReportedBanner({ count, t }: { count: number; t: Translate }) {
  if (count === 0) return null;
  return (
    <div className="bg-danger/10 border-b border-danger/30 text-danger px-4 py-3 text-sm">
      {count === 1
        ? t('admin.systemVersions.ci.notReportedWarning', { count })
        : t('admin.systemVersions.ci.notReportedWarningPlural', { count })}
    </div>
  );
}

function GateTable({ gates, t }: { gates: CiGateRow[]; t: Translate }) {
  return (
    <div className="overflow-x-auto">
      <DataTable className="min-w-[640px]">
        <DataTableHead>
          <DataTableCell as="th">{t('admin.systemVersions.ci.columns.gate')}</DataTableCell>
          <DataTableCell as="th">{t('admin.systemVersions.ci.columns.job')}</DataTableCell>
          <DataTableCell as="th">{t('admin.systemVersions.ci.columns.verdict')}</DataTableCell>
        </DataTableHead>
        <tbody>
          {gates.map((gate) => (
            <DataTableRow key={`${gate.job}/${gate.step}`}>
              <DataTableCell className="text-foreground-secondary">{gate.step}</DataTableCell>
              <DataTableCell className="text-muted whitespace-nowrap">{gate.job}</DataTableCell>
              <DataTableCell className={`whitespace-nowrap ${verdictClass(gate.verdict)}`}>
                {verdictLabel(t, gate.verdict)}
              </DataTableCell>
            </DataTableRow>
          ))}
        </tbody>
      </DataTable>
    </div>
  );
}

function CardFooter({
  health,
  passed,
  locale,
  t,
}: {
  health: CiHealthResponse;
  passed: number;
  locale: AppLocale;
  t: Translate;
}) {
  return (
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
      <GreenMarker run={health.lastAllGreenRun} locale={locale} t={t} />
      <RateLimitNote
        remaining={health.rateLimitRemaining}
        authenticated={health.authenticated}
        t={t}
      />
    </div>
  );
}

/**
 * Deliberately shown with its date. On a repo where one job stays red for months
 * this is months behind HEAD, and its staleness is the honest signal — the
 * per-gate table above it is the real reading.
 */
function GreenMarker({ run, locale, t }: { run: CiRun | null; locale: AppLocale; t: Translate }) {
  return (
    <p>
      {run
        ? t('admin.systemVersions.ci.lastAllGreen', {
            sha: run.sha.slice(0, 8),
            time: formatWhen(run.createdAt, locale),
          })
        : t('admin.systemVersions.ci.neverAllGreen')}
    </p>
  );
}

function RateLimitNote({
  remaining,
  authenticated,
  t,
}: {
  remaining: number | null;
  authenticated: boolean;
  t: Translate;
}) {
  if (remaining === null) return null;
  return (
    <p>
      {authenticated
        ? t('admin.systemVersions.ci.rateLimit', { remaining })
        : t('admin.systemVersions.ci.rateLimitAnon', { remaining })}
    </p>
  );
}
