'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { SegmentedTabs } from '@myclash/ui';
import { useI18n } from '@/i18n/I18nProvider';
import type { MyEventInfo } from './types';

export type HubTab = 'schedule' | 'overview' | 'workshops';

function fmtDate(d: string | null, tag: string): string {
  if (!d) return '';
  // Parse date-only strings at noon to avoid timezone day-shift on the label.
  const date = new Date(`${d}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(tag, { day: 'numeric', month: 'short' });
}

export function EventHubChrome({
  event,
  active,
  children,
}: {
  event: MyEventInfo;
  active: HubTab;
  children: ReactNode;
}): ReactNode {
  const { t, locale } = useI18n();
  const router = useRouter();
  const tag = locale === 'fr' ? 'fr-FR' : 'en-GB';
  const base = `/me/events/${event.slug}`;
  // Overview is the default landing (index route); schedule + workshops are nested.
  const routeFor = (tab: HubTab) => (tab === 'overview' ? base : `${base}/${tab}`);

  const dates = [fmtDate(event.startDate, tag), fmtDate(event.endDate, tag)]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(' – ');

  return (
    <main id="main-content" className="mx-auto min-h-screen max-w-2xl">
      <div className="sticky top-16 z-sticky border-b border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <Link
            href="/me/events"
            aria-label={t('publicApp.me.hub.back')}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-foreground"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </Link>
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-bold leading-tight">{event.name}</h1>
            {dates && <p className="text-xs text-muted">{dates}</p>}
          </div>
        </div>
        <SegmentedTabs
          className="mt-3"
          aria-label={event.name}
          value={active}
          onChange={(tab) => router.push(routeFor(tab as HubTab))}
          tabs={[
            { value: 'overview', label: t('publicApp.me.hub.tabOverview') },
            { value: 'schedule', label: t('publicApp.me.hub.tabSchedule') },
            { value: 'workshops', label: t('publicApp.me.hub.tabWorkshops') },
          ]}
        />
      </div>
      <div className="px-4 py-4">{children}</div>
    </main>
  );
}

/** Shared loading + not-found chrome used by the three hub tab pages. */
export function HubLoading(): ReactNode {
  return (
    <main id="main-content" className="mx-auto min-h-screen max-w-2xl px-4 py-6">
      <div className="h-6 w-40 animate-pulse rounded bg-foreground/10 motion-reduce:animate-none" />
      <div className="mt-4 flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-20 w-full animate-pulse rounded-xl bg-foreground/10 motion-reduce:animate-none"
          />
        ))}
      </div>
    </main>
  );
}

export function HubNotFound(): ReactNode {
  const { t } = useI18n();
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-screen max-w-2xl items-center justify-center px-4 text-center"
    >
      <div>
        <p className="font-display text-xl font-bold">{t('publicApp.me.hub.notFound')}</p>
        <Link href="/me/events" className="mt-3 inline-block text-sm font-semibold text-accent">
          {t('publicApp.me.hub.back')}
        </Link>
      </div>
    </main>
  );
}
