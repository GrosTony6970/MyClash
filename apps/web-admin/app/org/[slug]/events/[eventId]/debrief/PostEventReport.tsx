'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { StatusBadge } from '@myclash/ui';
import { t } from '@myclash/i18n';
import { getPublicApiUrl } from '@/lib/api-url';
import { BackLink } from '@/components/BackLink';

interface ReportSection {
  key: string;
  severity: 'ok' | 'attention';
  count: number;
  details: string[];
}

interface Report {
  sections: ReportSection[];
  needsAttention: boolean;
}

function useReport(eventId: string): { report: Report | null; loading: boolean } {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const res = await fetch(`${getPublicApiUrl()}/api/v1/events/${eventId}/post-event-report`, {
          credentials: 'include',
          signal,
        });
        if (res.ok) setReport((await res.json()) as Report);
      } catch {
        // Leave the report null; the page says it could not load rather than
        // rendering an all-clear it did not receive.
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [eventId],
  );

  // Deferred off the effect body — setState inside one cascades renders and the
  // repo lints it at max-warnings 0.
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => {
      controller.abort();
    };
  }, [load]);

  return { report, loading };
}

function SectionCard({ section }: { section: ReportSection }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display font-semibold text-foreground">
          {t(`organizer.debrief.sections.${section.key}`)}
        </h2>
        <StatusBadge
          semantic={section.severity === 'attention' ? 'paused' : 'done'}
          surface="light"
        >
          {String(section.count)}
        </StatusBadge>
      </div>
      <p className="mt-1 text-xs text-muted">{t(`organizer.debrief.hints.${section.key}`)}</p>
      {section.details.length > 0 && (
        <ul className="mt-2 space-y-1">
          {section.details.map((detail) => (
            <li key={detail} className="text-xs text-foreground-secondary">
              {detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The event, after the fact.
 *
 * Every section renders even at zero: an absent section reads as "not checked",
 * which is the opposite of the reassurance a clean report is supposed to give.
 */
export function PostEventReport({ slug, eventId }: { slug: string; eventId: string }) {
  const { report, loading } = useReport(eventId);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <BackLink href={`/org/${slug}/events/${eventId}`} label={t('organizer.debrief.back')} />
      <h1 className="mt-2 font-display text-2xl font-bold sm:text-3xl">
        {t('organizer.debrief.title')}
      </h1>
      <p className="mt-1 text-sm text-foreground-secondary">{t('organizer.debrief.subtitle')}</p>

      {loading && <p className="mt-6 text-sm text-muted">{t('organizer.debrief.loading')}</p>}
      {!loading && !report && (
        <p className="mt-6 text-sm text-danger">{t('organizer.debrief.loadError')}</p>
      )}

      {report && (
        <>
          <p className="mt-4 text-sm font-semibold text-foreground">
            {report.needsAttention
              ? t('organizer.debrief.headlineAttention')
              : t('organizer.debrief.headlineClean')}
          </p>
          <div className="mt-4 space-y-3">
            {report.sections.map((section) => (
              <SectionCard key={section.key} section={section} />
            ))}
          </div>
          {/* The clock detail is not rebuilt here — it has its own report, and a
              second derivation would drift from it. */}
          <Link
            href={`/org/${slug}/events/${eventId}/clock`}
            className="mt-4 inline-block text-sm font-semibold text-accent"
          >
            {t('organizer.debrief.openClockReport')}
          </Link>
        </>
      )}
    </main>
  );
}
