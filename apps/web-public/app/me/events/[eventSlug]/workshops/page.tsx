'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { formatInZone } from '@myclash/time';
import { EmptyState, Skeleton } from '@myclash/ui';
import { getPublicApiUrl } from '@/lib/api-url';
import { EventHubChrome, HubLoading, HubNotFound } from '@/components/me/EventHubChrome';
import { WorkshopRegisterControls, registerLabels } from '@/components/me/WorkshopRegisterControls';
import {
  bookingsOf,
  changeBooking,
  refusalWords,
  tapEnded,
  tapStarted,
  type TapsInFlight,
  type WorkshopBooking,
} from '@/components/me/workshop-booking';
import { WorkshopCard, workshopDayLabel } from '@/components/workshops/WorkshopCard';
import {
  groupWorkshopsByDay,
  type WorkshopListItem,
} from '@/components/workshops/workshop-grouping';
import { ClashCheckNotice } from '@/components/me/ClashCheckNotice';
import { clashOf, clashWords, commitmentsOf } from '@/components/me/workshop-clash';
import { useI18n } from '@myclash/next-i18n/client';
import { useMyEvents, useMySchedule } from '@/components/me/hooks';
import type { MyEventInfo, MyEventWorkshopTeaching } from '@/components/me/types';

type WorkshopSession = WorkshopListItem['sessions'][number];

export default function HubWorkshopsPage() {
  const { eventSlug } = useParams<{ eventSlug: string }>();
  const { events, loading } = useMyEvents();
  const myEvent = events?.find((e) => e.event.slug === eventSlug) ?? null;

  if (loading) return <HubLoading />;
  if (!myEvent) return <HubNotFound />;

  return (
    <EventHubChrome event={myEvent.event} active="workshops">
      <WorkshopsContent event={myEvent.event} teaching={myEvent.workshopsTeaching} />
    </EventHubChrome>
  );
}

function WorkshopsContent({
  event,
  teaching,
}: {
  event: MyEventInfo;
  teaching: MyEventWorkshopTeaching[];
}) {
  const { t, locale } = useI18n();
  const tag = locale === 'fr' ? 'fr-FR' : 'en-GB';
  const tz = event.timezone ?? 'Europe/Paris';
  const api = getPublicApiUrl();

  const [workshops, setWorkshops] = useState<WorkshopListItem[] | null>(null);
  const [wsKey, setWsKey] = useState(0);
  const [busy, setBusy] = useState<TapsInFlight>(new Set());
  const [refused, setRefused] = useState<{ sessionId: string; words: string } | null>(null);
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

  // Session id → what the viewer's booking of it is: a seat, a waitlist place, a refusal.
  const bookings = useMemo(() => bookingsOf(schedule), [schedule]);

  // Workshops the viewer TEACHES (parent workshop ids, so these key off `w.id`,
  // unlike `bookings` above which is keyed by session id). Teaching one means no
  // participant seat in it — the API rejects the enroll either way.
  const teachingIds = useMemo(() => new Set(teaching.map((w) => w.workshopId)), [teaching]);

  // Deep-link from a schedule workshop card (`…/workshops#workshop-<slug>`):
  // once the list has loaded, scroll that workshop's card into view. Once only.
  const didScrollRef = useRef(false);
  useEffect(() => {
    if (didScrollRef.current || workshops === null) return;
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    if (!hash.startsWith('#workshop-')) {
      didScrollRef.current = true;
      return;
    }
    const el = document.getElementById(hash.slice(1));
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'auto' });
      didScrollRef.current = true;
    }
  }, [workshops]);

  const { commitments, unchecked } = useMemo(
    () => commitmentsOf(schedule, t('publicApp.me.schedule.referee')),
    [schedule, t],
  );

  const fmtTime = (iso: string | null) =>
    iso ? formatInZone(iso, tz, { hour: '2-digit', minute: '2-digit' }, tag) : '';

  const conflictFor = (session: WorkshopSession): string | null => {
    const clash = clashOf(session, commitments);
    return clash && t('publicApp.me.workshops.conflictsWith', clashWords(clash, fmtTime));
  };

  // One tap is one call, and the page reads again whatever the server answers. A
  // refusal is said under its session's button until the next tap (ruling 294).
  // Two taps close together: an accepted answer never takes the other's line away.
  const act = useCallback(
    async (sessionId: string, action: 'book' | 'cancel', booking: WorkshopBooking = 'none') => {
      setBusy((taps) => tapStarted(taps, sessionId));
      setRefused(null);
      const change = await changeBooking(api, sessionId, action, booking);
      setBusy((taps) => tapEnded(taps, sessionId));
      const words = change.ok ? null : refusalWords(change, t);
      if (words) setRefused({ sessionId, words });
      setWsKey((k) => k + 1);
      refreshSchedule();
    },
    [api, refreshSchedule, t],
  );

  if (workshops === null) return <Skeleton className="h-40 w-full rounded-xl" />;

  // One card per workshop that still has a live (non-cancelled) session.
  const visible = workshops.filter((w) => w.sessions.some((s) => s.status !== 'cancelled'));
  if (visible.length === 0) return <EmptyState title={t('publicApp.me.workshops.empty')} />;

  const groups = groupWorkshopsByDay(visible, tz);
  const labels = registerLabels(t);

  return (
    <div className="flex flex-col gap-6">
      <ClashCheckNotice count={unchecked} />
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            {workshopDayLabel(group, tz, t, tag)}
          </h2>
          <div className="flex flex-col gap-4">
            {group.items.map((w) => {
              const session = w.sessions.find((s) => s.status !== 'cancelled')!;
              const teaches = teachingIds.has(w.id);
              const booking = bookings.get(session.id) ?? 'none';
              const remaining =
                session.capacity != null
                  ? Math.max(0, session.capacity - session.confirmedCount)
                  : null;
              const full = session.capacity != null && remaining === 0;
              // Rating unlocks for attendees once the session has started.
              const started =
                session.startsAt != null && new Date(session.startsAt).getTime() <= Date.now();
              return (
                <div key={w.id} id={`workshop-${w.slug}`} className="scroll-mt-24">
                  <WorkshopCard
                    workshop={w}
                    timezone={tz}
                    highlighted={booking === 'confirmed'}
                    showLocation
                    footer={
                      <div className="flex flex-col gap-2">
                        <WorkshopRegisterControls
                          booking={booking}
                          full={full}
                          conflict={conflictFor(session)}
                          busy={busy.has(session.id)}
                          isInstructor={teaches}
                          labels={labels}
                          onRegister={() => void act(session.id, 'book', booking)}
                          onCancel={() => void act(session.id, 'cancel')}
                        />
                        {refused?.sessionId === session.id && (
                          <p role="alert" className="text-xs font-semibold text-danger">
                            {refused.words}
                          </p>
                        )}
                        {booking === 'confirmed' && started && (
                          <WorkshopRatingControl workshopId={w.id} api={api} />
                        )}
                      </div>
                    }
                  />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// Participant rating for a workshop they attended (session already started).
// One editable rating (1..5) + optional comment; prefilled from my-feedback.
function WorkshopRatingControl({ workshopId, api }: { workshopId: string; api: string }) {
  const { t } = useI18n();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${api}/api/v1/workshops/${workshopId}/my-feedback`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { rating: number; comment: string | null } | null;
        if (data) {
          setRating(data.rating);
          setComment(data.comment ?? '');
        }
      })
      .catch(() => {
        // prefill is best-effort
      });
    return () => controller.abort();
  }, [api, workshopId]);

  async function submit() {
    if (rating < 1) return;
    setBusy(true);
    setError(false);
    setSaved(false);
    try {
      const res = await fetch(`${api}/api/v1/workshops/${workshopId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ rating, comment: comment.trim() || null }),
      });
      if (!res.ok) throw new Error('feedback');
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {t('publicApp.me.workshops.rateTitle')}
      </p>
      <div className="mt-1 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={t('publicApp.me.workshops.rateStarLabel', { n })}
            onClick={() => {
              setRating(n);
              setSaved(false);
            }}
            // gold-text clears the WCAG 1.4.11 3:1 floor for non-text glyphs;
            // plain --color-gold sits at 2.06:1 on light.
            className={`text-xl leading-none ${n <= rating ? 'text-gold-text' : 'text-muted'}`}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        rows={2}
        value={comment}
        maxLength={2000}
        placeholder={t('publicApp.me.workshops.rateCommentPlaceholder')}
        onChange={(e) => {
          setComment(e.target.value);
          setSaved(false);
        }}
        className="mt-2 w-full resize-none rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
      {error && <p className="mt-1 text-sm text-danger">{t('publicApp.me.workshops.rateError')}</p>}
      {saved && (
        <p className="mt-1 text-sm text-success">{t('publicApp.me.workshops.rateSaved')}</p>
      )}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={busy || rating < 1}
          onClick={() => void submit()}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
        >
          {t('publicApp.me.workshops.rateSubmit')}
        </button>
      </div>
    </div>
  );
}
