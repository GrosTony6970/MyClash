'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useEffect, useState } from 'react';
import { apiRequest } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { BackLink } from '@/components/BackLink';

type ClockConfidence = 'ok' | 'skewed' | 'unmeasured';

interface ClockRow {
  staffAccountId: string;
  username: string;
  heartbeatSkewMs: number | null;
  lastSeenAt: string | null;
  exchangeCount: number;
  estimatedSkewMs: number | null;
  worstSyncLagMs: number | null;
  outOfEnvelopeCount: number;
  confidence: ClockConfidence;
}

interface ClockReport {
  rows: ClockRow[];
  needsAttention: number;
  hasUnmeasured: boolean;
}

/**
 * Clock reconciliation — can the timings on this event's results be trusted?
 *
 * Event-scoped and organiser-facing. Deliberately NOT the platform review queue
 * (`@PlatformRole('platform_admin')`): a tablet with a wrong clock is fixed by
 * the person standing next to it in the hall, and routing venue operations to
 * platform admins would bury it under things only they can act on.
 *
 * Every judgement lives server-side in `clock-reconciliation.ts`; this renders
 * what it concluded and, where the answer is "we cannot tell", says so instead
 * of picking a colour.
 */
export function ClockReport({ slug, eventId }: { slug: string; eventId: string }) {
  const { t } = useI18n();

  const { report, error, loading } = useClockReport(eventId);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <BackLink href={`/org/${slug}/events/${eventId}`} label={t('organizer.clockReport.back')} />
      <h1 className="mt-2 font-display text-2xl font-bold sm:text-3xl">
        {t('organizer.clockReport.title')}
      </h1>
      <p className="mt-1 text-sm text-foreground-secondary">
        {t('organizer.clockReport.subtitle')}
      </p>

      {loading && <p className="mt-6 text-sm text-muted">{t('organizer.clockReport.loading')}</p>}
      {error && <p className="mt-6 text-sm text-danger">{error}</p>}
      {report && <ReportBody report={report} />}
    </main>
  );
}

/** Module scope and state-free — `react-hooks/set-state-in-effect` is an error here. */
function fetchReport(eventId: string): Promise<ClockReport | null> {
  return apiRequest<ClockReport>(
    getPublicApiUrl(),
    `/api/v1/events/${eventId}/clock-reconciliation`,
  ).then((r) => (r.ok ? r.data : null));
}

function useClockReport(eventId: string) {
  const { t } = useI18n();

  const [report, setReport] = useState<ClockReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetchReport(eventId).then((next) => {
      if (cancelled) return;
      setReport(next);
      setError(next ? null : t('organizer.clockReport.loadError'));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [eventId, t]);

  return { report, error, loading };
}

function ReportBody({ report }: { report: ClockReport }) {
  const { t } = useI18n();

  if (report.rows.length === 0) {
    return <p className="mt-6 text-sm text-muted">{t('organizer.clockReport.noStaff')}</p>;
  }

  return (
    <>
      <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
        {report.needsAttention === 0
          ? t('organizer.clockReport.allClear')
          : t('organizer.clockReport.needsAttention', { count: report.needsAttention })}
      </p>
      <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
        {report.rows.map((row) => (
          <ClockRowItem key={row.staffAccountId} row={row} />
        ))}
      </ul>
    </>
  );
}

function ClockRowItem({ row }: { row: ClockRow }) {
  const { t } = useI18n();

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-foreground">{row.username}</span>
        <ConfidenceBadge confidence={row.confidence} />
      </div>
      <p className="mt-1 text-sm text-muted">
        {t('organizer.clockReport.measured', {
          skew: formatSigned(row.heartbeatSkewMs ?? row.estimatedSkewMs),
          exchanges: String(row.exchangeCount),
        })}
      </p>
      {/* Lag is named separately on purpose: it is the outbox doing its job
          through a wifi drop, not a clock problem, and conflating the two is
          how a report starts crying wolf on every normal outage. */}
      {row.worstSyncLagMs !== null && row.worstSyncLagMs > 0 && (
        <p className="mt-0.5 text-sm text-muted">
          {t('organizer.clockReport.syncLag', { lag: formatDuration(row.worstSyncLagMs) })}
        </p>
      )}
      {row.outOfEnvelopeCount > 0 && (
        <p className="mt-0.5 text-sm text-warning">
          {t('organizer.clockReport.outOfEnvelope', { count: String(row.outOfEnvelopeCount) })}
        </p>
      )}
    </li>
  );
}

function ConfidenceBadge({ confidence }: { confidence: ClockConfidence }) {
  const { t } = useI18n();

  const tone =
    confidence === 'skewed'
      ? 'bg-warning/15 text-warning'
      : confidence === 'ok'
        ? 'bg-success/15 text-success'
        : 'bg-muted/15 text-muted';

  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${tone}`}>
      {t(confidenceKey(confidence))}
    </span>
  );
}

/** Literal keys, one per state — never assembled from a template. */
function confidenceKey(confidence: ClockConfidence): string {
  switch (confidence) {
    case 'ok':
      return 'organizer.clockReport.confidence.ok';
    case 'skewed':
      return 'organizer.clockReport.confidence.skewed';
    case 'unmeasured':
      return 'organizer.clockReport.confidence.unmeasured';
  }
}

/**
 * A skew reading, with its sign kept.
 *
 * Positive is a tablet AHEAD of the server. Dropping the sign would make "this
 * bout was recorded too long" and "too short" read identically.
 */
function formatSigned(ms: number | null): string {
  if (ms === null) return '—';
  const sign = ms > 0 ? '+' : ms < 0 ? '-' : '';
  return `${sign}${formatDuration(Math.abs(ms))}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
