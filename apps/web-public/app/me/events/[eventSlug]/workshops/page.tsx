'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { formatInZone } from '@myclash/time';
import { EmptyState, Skeleton } from '@myclash/ui';
import { getApiUrl } from '@/lib/api-url';
import { EventHubChrome, HubLoading, HubNotFound } from '@/components/me/EventHubChrome';
import { WorkshopRegisterControls } from '@/components/me/WorkshopRegisterControls';
import {
  WorkshopCard,
  groupWorkshopsByDay,
  workshopDayLabel,
  type WorkshopListItem,
} from '@/components/workshops/WorkshopCard';
import { overlaps, toTimed, type TimedItem } from '@/components/me/conflicts';
import { useI18n } from '@/i18n/I18nProvider';
import { useMyEvents, useMySchedule } from '@/components/me/hooks';
import type { MyEventInfo } from '@/components/me/types';

type WorkshopSession = WorkshopListItem['sessions'][number];

export default function HubWorkshopsPage() {
  const { eventSlug } = useParams<{ eventSlug: string }>();
  const { events, loading } = useMyEvents();
  const myEvent = events?.find((e) => e.event.slug === eventSlug) ?? null;

  if (loading) return <HubLoading />;
  if (!myEvent) return <HubNotFound />;

  return (
    <EventHubChrome event={myEvent.event} active="workshops">
      <WorkshopsContent event={myEvent.event} />
    </EventHubChrome>
  );
}

function WorkshopsContent({ event }: { event: MyEventInfo }) {
  const { t, locale } = useI18n();
  const tag = locale === 'fr' ? 'fr-FR' : 'en-GB';
  const tz = event.timezone ?? 'Europe/Paris';
  const api = getApiUrl();

  const [workshops, setWorkshops] = useState<WorkshopListItem[] | null>(null);
  const [wsKey, setWsKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const { schedule, refresh: refreshSchedule } = useMySchedule(event.id);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${api}/api/v1/events/${event.slug}/public-workshops`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) setWorkshops((await res.json()) as WorkshopListItem[]);
        else setWorkshops([]);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) setWorkshops([]);
      });
    return () => controller.abort();
  }, [api, event.slug, wsKey]);

  const enrolledIds = useMemo(
    () => new Set((schedule?.workshops ?? []).map((w) => w.workshopId)),
    [schedule],
  );

  // The user's fights + referee slots as timed windows, for conflict checks.
  const commitments = useMemo<TimedItem[]>(() => {
    if (!schedule) return [];
    return [
      ...schedule.matches.flatMap((m) => {
        const ti = toTimed(`fight-${m.id}`, m.opponentName ?? m.matchNumberLabel, m.scheduledAt);
        return ti ? [ti] : [];
      }),
      ...schedule.refereeSlots.flatMap((r) => {
        const ti = toTimed(
          `ref-${r.matchId}`,
          `${t('publicApp.me.schedule.referee')} · ${r.matchNumberLabel}`,
          r.scheduledAt,
        );
        return ti ? [ti] : [];
      }),
    ];
  }, [schedule, t]);

  const fmtTime = (iso: string | null) =>
    iso ? formatInZone(iso, tz, { hour: '2-digit', minute: '2-digit' }, tag) : '';

  const conflictFor = (s: WorkshopSession): string | null => {
    const ti = toTimed(`ws-${s.id}`, '', s.startsAt, s.endsAt);
    if (!ti) return null;
    const clash = commitments.find((c) => overlaps(ti.start, ti.end, c.start, c.end));
    if (!clash) return null;
    return t('publicApp.me.workshops.conflictsWith', {
      item: clash.label,
      time: fmtTime(new Date(clash.start).toISOString()),
    });
  };

  const act = useCallback(
    async (sessionId: string, method: 'POST' | 'DELETE') => {
      setBusy(sessionId);
      try {
        await fetch(`${api}/api/v1/workshop-sessions/${sessionId}/enroll`, {
          method,
          credentials: 'include',
        });
      } finally {
        setBusy(null);
        setWsKey((k) => k + 1);
        refreshSchedule();
      }
    },
    [api, refreshSchedule],
  );

  if (workshops === null) return <Skeleton className="h-40 w-full rounded-xl" />;

  // One card per workshop that still has a live (non-cancelled) session.
  const visible = workshops.filter((w) => w.sessions.some((s) => s.status !== 'cancelled'));
  if (visible.length === 0) return <EmptyState title={t('publicApp.me.workshops.empty')} />;

  const groups = groupWorkshopsByDay(visible, tz);
  const labels = {
    register: t('publicApp.me.workshops.register'),
    registerAnyway: t('publicApp.me.workshops.registerAnyway'),
    cancel: t('publicApp.me.workshops.cancel'),
    registered: t('publicApp.me.workshops.registered'),
    joinWaitlist: t('publicApp.me.workshops.joinWaitlist'),
    full: t('publicApp.me.workshops.full'),
  };

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            {workshopDayLabel(group, tz, t, tag)}
          </h2>
          <div className="flex flex-col gap-4">
            {group.items.map((w) => {
              const session = w.sessions.find((s) => s.status !== 'cancelled')!;
              const enrolled = enrolledIds.has(session.id);
              const remaining =
                session.capacity != null
                  ? Math.max(0, session.capacity - session.confirmedCount)
                  : null;
              const full = session.capacity != null && remaining === 0 && !enrolled;
              return (
                <WorkshopCard
                  key={w.id}
                  workshop={w}
                  timezone={tz}
                  highlighted={enrolled}
                  showLocation
                  footer={
                    <WorkshopRegisterControls
                      enrolled={enrolled}
                      full={full}
                      conflict={enrolled ? null : conflictFor(session)}
                      busy={busy === session.id}
                      labels={labels}
                      onRegister={() => void act(session.id, 'POST')}
                      onCancel={() => void act(session.id, 'DELETE')}
                    />
                  }
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
