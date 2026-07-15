'use client';

import Link from 'next/link';
import { formatInZone } from '@myclash/time';
import { useI18n } from '@/i18n/I18nProvider';
import { CommitmentCard } from './CommitmentCard';
import { useMyEvents, useUpcoming } from './hooks';
import type { UpcomingItem } from './types';

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 mt-1 text-[11px] font-bold uppercase tracking-wide text-muted">{children}</p>
  );
}

/**
 * "Today" glance at the top of the personal dashboard: a prominent Enable-alerts
 * prompt, the cross-event "Next up" commitments, and the user's events. Renders
 * above the existing stats / claimable / linked-profile sections.
 */
export function DashboardToday() {
  const { t, locale } = useI18n();
  const tag = locale === 'fr' ? 'fr-FR' : 'en-GB';
  const { items } = useUpcoming(3);
  const { events } = useMyEvents();

  const fmt = (i: UpcomingItem) =>
    formatInZone(
      i.scheduledAt,
      i.eventTimezone ?? 'Europe/Paris',
      { weekday: 'short', hour: '2-digit', minute: '2-digit' },
      tag,
    );

  return (
    <div className="flex flex-col gap-1">
      <Link
        href="/me/notifications"
        className="flex items-start gap-3 rounded-xl border border-accent/30 bg-accent/5 p-3.5"
      >
        <span className="mt-0.5 text-accent">
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-foreground">
            {t('publicApp.me.enableAlerts.title')}
          </span>
          <span className="mt-0.5 block text-xs text-muted">
            {t('publicApp.me.enableAlerts.body')}
          </span>
        </span>
        <span className="shrink-0 self-center rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-accent-foreground">
          {t('publicApp.me.enableAlerts.action')}
        </span>
      </Link>

      {items && items.length > 0 && (
        <div className="mt-3">
          <Eyebrow>{t('publicApp.me.hub.nextUp')}</Eyebrow>
          <div className="flex flex-col gap-2">
            {items.map((i) => (
              <CommitmentCard
                key={`${i.kind}-${i.matchId}`}
                kind={i.kind}
                timeLabel={fmt(i)}
                place={i.liceName ?? i.poolName}
                title={
                  i.kind === 'fight'
                    ? `${t('publicApp.me.schedule.vs')} ${i.opponentName ?? t('publicApp.me.schedule.tbd')}`
                    : `${t('publicApp.me.schedule.referee')} · ${i.matchNumberLabel}`
                }
                meta={[i.eventName, i.tournamentName].filter(Boolean).join(' · ') || null}
                side={i.isRed === false ? 'blue' : 'red'}
                href={`/me/events/${i.eventSlug}/schedule`}
                refLabel={t('publicApp.me.events.roleReferee')}
              />
            ))}
          </div>
        </div>
      )}

      {events && events.length > 0 && (
        <div className="mt-4">
          <Eyebrow>{t('publicApp.me.events.title')}</Eyebrow>
          <div className="flex flex-col gap-2">
            {events.map((e) => (
              <Link
                key={e.event.id}
                href={`/me/events/${e.event.slug}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3.5 transition-colors hover:border-accent"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                  >
                    <path d="M3 7h18v13H3z" />
                    <path d="M16 3v4M8 3v4M3 11h18" />
                  </svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{e.event.name}</span>
                  <span className="mt-0.5 flex flex-wrap gap-1.5">
                    {e.roles.isCompetitor && (
                      <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">
                        {t('publicApp.me.events.roleCompetitor')}
                      </span>
                    )}
                    {e.roles.isReferee && (
                      <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold text-warning">
                        {t('publicApp.me.events.roleReferee')}
                      </span>
                    )}
                  </span>
                </span>
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5 shrink-0 text-muted"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
