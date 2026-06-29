'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { formatInZone } from '@myclash/time';
import { EmptyState, Skeleton } from '@myclash/ui';
import { getApiUrl } from '@/lib/api-url';
import { EventHubChrome, HubLoading, HubNotFound } from '@/components/me/EventHubChrome';
import { WorkshopSessionCard } from '@/components/me/WorkshopSessionCard';
import { overlaps, toTimed, type TimedItem } from '@/components/me/conflicts';
import { useI18n } from '@/i18n/I18nProvider';
import { useMyEvents, useMySchedule } from '@/components/me/hooks';
import type { MyEventInfo } from '@/components/me/types';

interface PublicSession {
  id: string;
  startsAt: string | null;
  endsAt: string | null;
  locationLabel: string | null;
  venue: { name: string } | null;
  area: { name: string } | null;
  capacity: number | null;
  confirmedCount: number;
  status: string | null;
}
interface PublicWorkshop {
  id: string;
  title: string;
  eventTimezone: string | null;
  sessions: PublicSession[];
}

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

  const [workshops, setWorkshops] = useState<PublicWorkshop[] | null>(null);
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
        if (res.ok) setWorkshops((await res.json()) as PublicWorkshop[]);
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
  const fmtDay = (iso: string | null) =>
    iso ? formatInZone(iso, tz, { weekday: 'short' }, tag) : '';

  const sessionTimeLabel = (s: PublicSession) => {
    if (!s.startsAt) return t('publicApp.me.workshops.tbd');
    const place = s.locationLabel ?? s.area?.name ?? s.venue?.name ?? null;
    const range = s.endsAt ? `${fmtTime(s.startsAt)}–${fmtTime(s.endsAt)}` : fmtTime(s.startsAt);
    return [`${fmtDay(s.startsAt)} ${range}`.trim(), place].filter(Boolean).join(' · ');
  };

  const conflictFor = (s: PublicSession): string | null => {
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

  const sessions = workshops.flatMap((w) =>
    w.sessions.filter((s) => s.status !== 'cancelled').map((s) => ({ workshop: w, session: s })),
  );

  if (sessions.length === 0) return <EmptyState title={t('publicApp.me.workshops.empty')} />;

  return (
    <div className="flex flex-col gap-2.5">
      {sessions.map(({ workshop, session }) => {
        const enrolled = enrolledIds.has(session.id);
        const remaining =
          session.capacity != null ? Math.max(0, session.capacity - session.confirmedCount) : null;
        const full = session.capacity != null && remaining === 0 && !enrolled;
        return (
          <WorkshopSessionCard
            key={session.id}
            title={workshop.title}
            timeLabel={sessionTimeLabel(session)}
            enrolled={enrolled}
            full={full}
            spotsLabel={
              remaining != null && !full
                ? t('publicApp.me.workshops.spotsLeft', { count: remaining })
                : null
            }
            conflict={enrolled ? null : conflictFor(session)}
            busy={busy === session.id}
            labels={{
              register: t('publicApp.me.workshops.register'),
              registerAnyway: t('publicApp.me.workshops.registerAnyway'),
              cancel: t('publicApp.me.workshops.cancel'),
              registered: t('publicApp.me.workshops.registered'),
              joinWaitlist: t('publicApp.me.workshops.joinWaitlist'),
              full: t('publicApp.me.workshops.full'),
            }}
            onRegister={() => void act(session.id, 'POST')}
            onCancel={() => void act(session.id, 'DELETE')}
          />
        );
      })}
    </div>
  );
}
