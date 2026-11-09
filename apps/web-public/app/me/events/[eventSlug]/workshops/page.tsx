'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { formatInZone } from '@myclash/time';
import { EmptyState, Skeleton } from '@myclash/ui';
import { getPublicApiUrl } from '@/lib/api-url';
import {
  EventHubChrome,
  HubLoading,
  HubNotFound,
  HubReadFailed,
} from '@/components/me/EventHubChrome';
import { WorkshopRegisterControls, registerLabels } from '@/components/me/WorkshopRegisterControls';
import {
  bookingsOf,
  changeBooking,
  placeElsewhereWords,
  refusalWords,
  tapEnded,
  tapStarted,
  type TapsInFlight,
  type WorkshopBooking,
} from '@/components/me/workshop-booking';
import { WorkshopCard, workshopDayLabel } from '@/components/workshops/WorkshopCard';
import { CancelledSessionLine, isCancelledSession } from '@/components/workshops/session-cancelled';
import {
  groupWorkshopsByDay,
  type WorkshopListItem,
} from '@/components/workshops/workshop-grouping';
import { ClashCheckNotice } from '@/components/me/ClashCheckNotice';
import { clashOf, clashWords, commitmentsOf } from '@/components/me/workshop-clash';
import { useI18n } from '@myclash/next-i18n/client';
import { useMyEvents } from '@/components/me/hooks';
import { useMySchedule } from '@/components/me/use-my-schedule';
import { ReadFailed } from '@/components/me/ReadFailed';
import type { MyEventInfo, MyEventWorkshopTeaching } from '@/components/me/types';

type WorkshopSession = WorkshopListItem['sessions'][number];

export default function HubWorkshopsPage() {
  const { eventSlug } = useParams<{ eventSlug: string }>();
  const { events, loading, error, retry } = useMyEvents();
  const myEvent = events?.find((e) => e.event.slug === eventSlug) ?? null;

  if (loading) return <HubLoading />;
  if (error) return <HubReadFailed onRetry={retry} />;
  if (!myEvent) return <HubNotFound />;

  return (
    <EventHubChrome myEvent={myEvent} active="workshops">
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
  // The list's read failed: it read as "No workshops for this event".
  const [listFailed, setListFailed] = useState(false);
  const [wsKey, setWsKey] = useState(0);
  const [busy, setBusy] = useState<TapsInFlight>(new Set());
  const [refused, setRefused] = useState<{ sessionId: string; words: string } | null>(null);
  const {
    schedule,
    state: scheduleState,
    refresh: refreshSchedule,
    retry: retrySchedule,
  } = useMySchedule(event.id);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${api}/api/v1/events/${event.slug}/public-workshops`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`public-workshops ${res.status}`);
        setWorkshops((await res.json()) as WorkshopListItem[]);
        setListFailed(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // Keep a list already on screen; with none, the page says the read failed.
        setWorkshops((before) => before ?? []);
        setListFailed(true);
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
  if (listFailed && workshops.length === 0) {
    return (
      <ReadFailed
        title={t('publicApp.me.workshops.loadFailed')}
        onRetry={() => setWsKey((k) => k + 1)}
      />
    );
  }
  // Her bookings could not be read: a session she holds would show as free.
  const bookingsUnread = scheduleState === 'failed' && (
    <ReadFailed title={t('publicApp.me.workshops.bookingsFailed')} onRetry={retrySchedule} />
  );

  // One card per Workshop and day; a Workshop runs several sessions (ruling 515), each with its own
  // button. A cancelled session stays, struck through and with no button (ruling 526).
  const isLive = (s: WorkshopSession) => !isCancelledSession(s);
  const visible = workshops.filter((w) => w.sessions.length > 0);
  // The refused tap's line, under its session's button. A session the organiser cancelled loses
  // its button at the read that follows the tap: its line is then said above the list.
  const refusedLine = refused && (
    <p role="alert" className="text-xs font-semibold text-danger">
      {refused.words}
    </p>
  );
  const shown = visible.flatMap((w) => w.sessions.filter(isLive).map((s) => s.id));
  const cardGone = refused !== null && !shown.includes(refused.sessionId);

  if (visible.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        {refusedLine}
        <EmptyState title={t('publicApp.me.workshops.empty')} />
      </div>
    );
  }

  const groups = groupWorkshopsByDay(visible, tz);
  const labels = registerLabels(t);
  // A Workshop listed under two days: its whole session list, for "you have a place on…", and
  // its anchor and rating on its first card only.
  const allSessions = new Map(visible.map((w) => [w.id, w.sessions]));
  const firstCard = new Set<string>();
  const fmtDayTime = (iso: string) =>
    formatInZone(iso, tz, { weekday: 'short', hour: '2-digit', minute: '2-digit' }, tag);

  return (
    <div className="flex flex-col gap-6">
      {cardGone && refusedLine}
      <ClashCheckNotice count={unchecked} />
      {bookingsUnread}
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            {workshopDayLabel(group, tz, t, tag)}
          </h2>
          <div className="flex flex-col gap-4">
            {group.items.map((w) => {
              const daySessions = w.sessions;
              const siblings = allSessions.get(w.id) ?? w.sessions;
              const teaches = teachingIds.has(w.id);
              const first = !firstCard.has(w.id);
              firstCard.add(w.id);
              // Rating unlocks for attendees once a session they had a seat in has started. A
              // cancelled one never ran (ruling 529).
              const rates = siblings.some(
                (s) =>
                  isLive(s) &&
                  bookings.get(s.id) === 'confirmed' &&
                  s.startsAt != null &&
                  new Date(s.startsAt).getTime() <= Date.now(),
              );
              return (
                <div
                  key={w.id}
                  id={first ? `workshop-${w.slug}` : undefined}
                  className="scroll-mt-24"
                >
                  <WorkshopCard
                    workshop={w}
                    timezone={tz}
                    highlighted={daySessions.some(
                      (s) => isLive(s) && bookings.get(s.id) === 'confirmed',
                    )}
                    showLocation
                    footer={
                      <div className="flex flex-col gap-3">
                        {daySessions.map((session) => {
                          if (!isLive(session)) {
                            const when = session.startsAt && fmtDayTime(session.startsAt);
                            return <CancelledSessionLine key={session.id} when={when} t={t} />;
                          }
                          const booking = bookings.get(session.id) ?? 'none';
                          const full =
                            session.capacity != null && session.confirmedCount >= session.capacity;
                          return (
                            <div key={session.id} className="flex flex-col gap-2">
                              {daySessions.length > 1 && session.startsAt && (
                                <p className="text-xs font-semibold text-foreground-secondary">
                                  {fmtDayTime(session.startsAt)}
                                </p>
                              )}
                              <WorkshopRegisterControls
                                booking={booking}
                                full={full}
                                conflict={conflictFor(session)}
                                busy={busy.has(session.id)}
                                isInstructor={teaches}
                                placeElsewhere={placeElsewhereWords(
                                  siblings,
                                  session.id,
                                  bookings,
                                  t,
                                  fmtDayTime,
                                )}
                                labels={labels}
                                onRegister={() => void act(session.id, 'book', booking)}
                                onCancel={() => void act(session.id, 'cancel')}
                              />
                              {refused?.sessionId === session.id && refusedLine}
                            </div>
                          );
                        })}
                        {first && rates && <WorkshopRatingControl workshopId={w.id} api={api} />}
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
        aria-label={t('publicApp.me.workshops.rateCommentPlaceholder')}
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
