'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@myclash/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { useMyEvents } from '@/components/me/hooks';
import { HubLoading } from '@/components/me/EventHubChrome';
import type { MyEvent } from '@/components/me/types';

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path d="M3 7h18v13H3z" />
      <path d="M16 3v4M8 3v4M3 11h18" />
    </svg>
  );
}

export default function MyEventsPage() {
  const { t } = useI18n();
  const { events, loading } = useMyEvents();

  if (loading) return <HubLoading />;
  if (!events || events.length === 0) return <ZeroState />;

  return (
    <main id="main-content" className="mx-auto min-h-screen max-w-2xl px-4 py-6">
      <h1 className="mb-4 font-display text-2xl font-bold">{t('publicApp.me.events.title')}</h1>
      <div className="flex flex-col gap-3">
        {events.map((e) => (
          <EventCard key={e.event.id} myEvent={e} />
        ))}
      </div>
    </main>
  );
}

function EventCard({ myEvent }: { myEvent: MyEvent }) {
  const { t } = useI18n();
  const { event, roles, counts } = myEvent;
  const countParts = [
    counts.matches ? t('publicApp.me.events.countMatches', { count: counts.matches }) : null,
    counts.refereeSlots
      ? t('publicApp.me.events.countReferee', { count: counts.refereeSlots })
      : null,
    counts.workshops ? t('publicApp.me.events.countWorkshops', { count: counts.workshops }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Link
      href={`/me/events/${event.slug}`}
      className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
        <CalendarIcon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">{event.name}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          {roles.isCompetitor && (
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-bold text-accent">
              {t('publicApp.me.events.roleCompetitor')}
            </span>
          )}
          {roles.isReferee && (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-bold text-warning">
              {t('publicApp.me.events.roleReferee')}
            </span>
          )}
          {roles.isInstructor && (
            <span className="rounded-full bg-instructor/15 px-2 py-0.5 text-[11px] font-bold text-instructor">
              {t('publicApp.me.events.roleInstructor')}
            </span>
          )}
        </span>
        {countParts && <span className="mt-1 block text-xs text-muted">{countParts}</span>}
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
  );
}

function ZeroState(): ReactNode {
  const { t } = useI18n();
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 text-center"
    >
      <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
        <CalendarIcon className="h-6 w-6" />
      </span>
      <h1 className="font-display text-xl font-bold">{t('publicApp.me.events.emptyTitle')}</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">{t('publicApp.me.events.emptyBody')}</p>
      <div className="mt-5 flex w-full max-w-xs flex-col gap-2">
        <Button asChild variant="primary" className="w-full">
          <Link href="/">{t('publicApp.me.events.findEvent')}</Link>
        </Button>
        <Button asChild variant="secondary" className="w-full">
          <Link href="/me">{t('publicApp.me.events.claimProfile')}</Link>
        </Button>
      </div>
    </main>
  );
}
