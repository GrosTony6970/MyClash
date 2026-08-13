'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useEffect, useState } from 'react';
import { getPublicApiUrl } from '@/lib/api-url';
import { BackLink } from '@/components/BackLink';
import { ReadinessRow } from '../_components/ReadinessPanel';
import { isOutstanding, type ReadinessReport } from '../readiness-copy';
import { buildStartOfDay, type StartOfDayStage } from '../start-of-day';

interface Props {
  slug: string;
  eventId: string;
}

/**
 * Start of day — the same readiness report, read as a sequence.
 *
 * The hub's readiness panel groups by tournament, which is how the week before
 * works: open Longsword, sort it out, open Rapier. That grouping is useless on
 * the morning, when there is exactly one question — what has to be true before
 * pool 1 match 1 — and the answer is a chain where each link depends on the one
 * above it.
 *
 * No new endpoint and no new rules. `buildStartOfDay` is a re-projection of the
 * report the panel already renders, and the rows are the panel's own component,
 * so a level's wording can only ever change in one place.
 */
export function StartOfDay({ slug, eventId }: Props) {
  const { t } = useI18n();

  const { report, error, loading } = useReadiness(eventId);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <BackLink href={`/org/${slug}/events/${eventId}`} label={t('organizer.startOfDay.back')} />
      <h1 className="mt-2 font-display text-2xl font-bold sm:text-3xl">
        {t('organizer.startOfDay.title')}
      </h1>
      <p className="mt-1 text-sm text-foreground-secondary">{t('organizer.startOfDay.subtitle')}</p>

      {loading && <p className="mt-6 text-sm text-muted">{t('organizer.startOfDay.loading')}</p>}
      {error && <p className="mt-6 text-sm text-danger">{error}</p>}
      {report && <StageList report={report} slug={slug} eventId={eventId} />}
    </main>
  );
}

/**
 * `fetchReadiness` is at module scope and state-free so the effect body holds no
 * setState — `react-hooks/set-state-in-effect` is an error in this repo.
 */
function fetchReadiness(eventId: string): Promise<ReadinessReport | null> {
  return fetch(`${getPublicApiUrl()}/api/v1/events/${eventId}/readiness`, {
    credentials: 'include',
  })
    .then((res) => (res.ok ? (res.json() as Promise<ReadinessReport>) : null))
    .catch(() => null);
}

function useReadiness(eventId: string) {
  const { t } = useI18n();

  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetchReadiness(eventId).then((next) => {
      if (cancelled) return;
      setReport(next);
      setError(next ? null : t('organizer.readiness.loadError'));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [eventId, t]);

  return { report, error, loading };
}

function StageList({
  report,
  slug,
  eventId,
}: {
  report: ReadinessReport;
  slug: string;
  eventId: string;
}) {
  const { t } = useI18n();

  const stages = buildStartOfDay(report);
  const outstanding = report.checks.filter(isOutstanding).length;

  return (
    <>
      <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
        {outstanding === 0
          ? t('organizer.startOfDay.allClear')
          : t('organizer.startOfDay.outstanding', { count: outstanding })}
      </p>
      <ol className="mt-4 space-y-4">
        {stages.map((stage, index) => (
          <Stage key={stage.key} stage={stage} index={index + 1} slug={slug} eventId={eventId} />
        ))}
      </ol>
    </>
  );
}

/**
 * One link in the chain.
 *
 * The current stage — the first with work left — is the only one given an
 * accent border. Everything above it is done and everything below is probably
 * waiting on it, so drawing attention to more than one place would defeat the
 * ordering this view exists to impose.
 */
function Stage({
  stage,
  index,
  slug,
  eventId,
}: {
  stage: StartOfDayStage;
  index: number;
  slug: string;
  eventId: string;
}) {
  const { t } = useI18n();

  return (
    <li
      className={[
        'rounded-lg border p-4',
        stage.current ? 'border-accent bg-accent/5' : 'border-border',
      ].join(' ')}
    >
      <StageHeader stage={stage} index={index} />

      {stage.checks.length === 0 ? (
        // A stage with no rows at all is not "done" — it is not applicable yet,
        // usually because the stage above it has not been completed. Saying so
        // is more honest than a green tick.
        <p className="mt-2 text-sm text-muted">{t('organizer.startOfDay.stageEmpty')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-md border border-border">
          {stage.checks.map((check) => (
            <ReadinessRow
              key={`${check.tournamentId ?? 'event'}-${check.key}`}
              check={check}
              slug={slug}
              eventId={eventId}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function StageHeader({ stage, index }: { stage: StartOfDayStage; index: number }) {
  const { t } = useI18n();

  const done = stage.outstandingCount === 0;

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="font-semibold text-foreground">
        <span className="mr-2 text-muted">{index}</span>
        {t(`organizer.startOfDay.stage.${stage.key}`)}
      </h2>
      <span className={`text-xs font-semibold ${done ? 'text-success' : 'text-warning'}`}>
        {done
          ? t('organizer.startOfDay.stageClear')
          : t('organizer.startOfDay.stageOutstanding', { count: stage.outstandingCount })}
      </span>
    </div>
  );
}
