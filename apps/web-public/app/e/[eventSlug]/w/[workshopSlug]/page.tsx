'use client';

/**
 * Workshop detail — T-803
 * Route: /e/[eventSlug]/w/[workshopSlug]
 *
 * AC:
 *   ✓ Sessions, capacity status, the register controls
 *   ✓ Anonymous can browse; a booking needs an account or a guest session
 *
 * The one booking door a guest reaches (operator ruling 261): each session shows
 * what the caller's booking of it is, with the controls of the personal Workshops
 * page. The server says who the caller is. The page cannot: both login cookies
 * are httpOnly, and the cookie check that stood here refused everybody.
 *
 * What the page says beside the controls (operator rulings 266, 267, 270, 271):
 * a clash with the caller's own fights and duties, as the personal Workshops
 * page does; that her bookings could not be read; who the booking door did not
 * know, and the ways in; and, to a guest, that a guest gets no alert.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, fetchMe, type MeSession } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { BackLink } from '@/components/BackLink';
import { WorkshopRegisterControls, registerLabels } from '@/components/me/WorkshopRegisterControls';
import { ClashCheckNotice } from '@/components/me/ClashCheckNotice';
import {
  changeBooking,
  guestPersonAt,
  placeElsewhereWords,
  readBookings,
  refusalWords,
  tapEnded,
  tapStarted,
  unknownCaller,
  type BookingChange,
  type CallerBookings,
  type TapsInFlight,
  type WorkshopBooking,
} from '@/components/me/workshop-booking';
import { clashOf, clashWords, commitmentsOf } from '@/components/me/workshop-clash';
import { CancelledBadge, isCancelledSession } from '@/components/workshops/session-cancelled';
import { useParams } from 'next/navigation';
import { formatInZone, localeToBcp47 } from '@myclash/time';
import { Button, accentClassFor } from '@myclash/ui';
import { EventHeader, fetchEventInfo, type EventInfo } from '../../_components/EventHeader';
import { useI18n } from '@myclash/next-i18n/client';
import { workshopPath, type Session, type Workshop } from './workshop-view';
import {
  BookingsUnread,
  GuestAlertsLine,
  SessionWhen,
  UnknownCallerNotice,
} from './WorkshopPageParts';
import { joinOffer, type StrangerTap } from './join-event';
import { WorkshopIntro } from './WorkshopIntro';

/**
 * What the page says after a tap: the booking as the server gave it, or why it
 * was refused. Nothing after a booking given up: the session's row says it. And
 * nothing for a caller the door did not know: the notice under the sessions
 * tells her the ways in, and stays (ruling 266).
 */
function changeNotice(change: BookingChange, t: (key: string) => string): string | null {
  if (change.ok) {
    if (change.status === 'cancelled') return null;
    return change.status === 'waitlisted'
      ? t('publicApp.workshopDetail.addedToWaitlist')
      : t('publicApp.workshopDetail.enrolledSuccess');
  }
  return change.why === 'nobody' ? null : refusalWords(change, t);
}

export default function WorkshopDetailPage() {
  const { t, locale } = useI18n();
  const params = useParams<{ eventSlug: string; workshopSlug: string }>();
  const { eventSlug, workshopSlug } = params;
  const apiUrl = getPublicApiUrl();

  const [workshop, setWorkshop] = useState<Workshop | null>(null);
  // The Workshop's read failed (not a 404): "could not load", never "not found".
  const [workshopFailed, setWorkshopFailed] = useState(false);
  const [eventInfo, setEventInfo] = useState<EventInfo | null>(null);
  const [loading, setLoading] = useState(true);
  // What the caller has at this Event: her bookings by session id, and her schedule
  // for the clash check. Nothing for nobody.
  const [caller, setCaller] = useState<CallerBookings>({ bookings: new Map(), schedule: null });
  const [readFailed, setReadFailed] = useState(false);
  // Who the booking door did not know at the last tap, and that tap: "Join and book" books it (568).
  const [unknown, setUnknown] = useState<StrangerTap | null>(null);
  const [me, setMe] = useState<MeSession | null>(null);
  const taps = useRef(0);
  const [busy, setBusy] = useState<TapsInFlight>(new Set());
  const [loadKey, setLoadKey] = useState(0);
  const load = useCallback(() => setLoadKey((key) => key + 1), []);
  const [toast, setToast] = useState<string | null>(null);

  // Event identity for the shared header band — mirrors the event home page.
  useEffect(() => {
    let cancelled = false;
    void fetchEventInfo(eventSlug, apiUrl, { credentials: 'include' }).then((read) => {
      if (!cancelled) setEventInfo(read.kind === 'found' ? read.event : null);
    });
    return () => {
      cancelled = true;
    };
  }, [eventSlug, apiUrl]);

  // Who the caller is, for the guest's line only. A read that failed shows no line.
  useEffect(() => {
    const controller = new AbortController();
    void fetchMe(apiUrl, { signal: controller.signal }).then((result) => {
      if (result.ok) setMe(result.data);
    });
    return () => controller.abort();
  }, [apiUrl]);

  // The Workshop and the caller's bookings of it, read together: at the first
  // load, and again after every tap (`load`). Two taps close together leave two
  // reads in flight; the cleanup aborts the older one, so the newer one wins.
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    // The route is public, but the seam sends the session anyway: it is what
    // lets the response carry `viewerIsInstructor` for the register button.
    void apiRequest<Workshop>(apiUrl, workshopPath(workshopSlug, eventSlug), { signal }).then(
      (result) => {
        // An abort means this effect was replaced, so the state it would set
        // belongs to a screen that is gone.
        if (result.ok) setWorkshop(result.data);
        else if (result.kind === 'aborted') return;
        // A 404 is "not found"; any other failure is a read that may work again.
        setWorkshopFailed(!result.ok && !(result.kind === 'http' && result.status === 404));
        setLoading(false);
      },
    );
    // A read that failed is no verdict: the page keeps what it shows, and says so.
    // An aborted one belongs to a screen that is gone.
    void readBookings(apiUrl, eventSlug, signal).then((read) => {
      if (signal.aborted) return;
      if (read) setCaller(read);
      setReadFailed(read === null);
    });
    return () => controller.abort();
  }, [workshopSlug, eventSlug, apiUrl, loadKey]);

  function say(text: string | null) {
    if (!text) return;
    setToast(text);
    setTimeout(() => setToast(null), 3000);
  }

  /**
   * One tap is one call. Whatever the server answers, the page reads again: a
   * refusal can mean the page was stale (an instructor removed the caller after
   * it loaded), and the row must then say so.
   */
  async function act(sessionId: string, action: 'book' | 'cancel', booking: WorkshopBooking) {
    const tap = ++taps.current;
    setBusy((taps) => tapStarted(taps, sessionId));
    const change = await changeBooking(apiUrl, sessionId, action, booking);
    setBusy((taps) => tapEnded(taps, sessionId));
    say(changeNotice(change, t));
    load();
    // The notice under the sessions follows the last tap: the door knew her, or did not.
    // Two taps close together: the `/me` answer of the older one must not undo the newer one's.
    const stranger = !change.ok && change.why === 'nobody';
    const who = stranger ? await unknownCaller(apiUrl) : null;
    if (taps.current === tap) setUnknown(who && { who, sessionId, booking });
  }
  const join = joinOffer(eventInfo, apiUrl);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="w-8 h-8 border-2 border-muted border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  if (!workshop) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <p className="text-4xl mb-3">📚</p>
          <h1 className="mb-3 font-display text-2xl font-bold text-foreground sm:text-3xl">
            {t(
              workshopFailed
                ? 'publicApp.workshopDetail.loadFailed'
                : 'publicApp.workshopDetail.notFound',
            )}
          </h1>
          {workshopFailed && (
            <Button type="button" variant="outline" onClick={load} className="mb-4 min-h-11">
              {t('actions.retry')}
            </Button>
          )}
          <BackLink
            href={`/e/${eventSlug}/workshops`}
            label={t('publicApp.eventHome.section.workshops')}
            className="mx-auto"
          />
        </div>
      </main>
    );
  }

  const tz = workshop.eventTimezone ?? 'Europe/Paris';
  const labels = registerLabels(t);
  // A cancelled session stays listed, struck through and with no control (ruling 526): people who
  // saw it know it is off. The API refuses a booking of one.
  const sessions = workshop.sessions;
  const bcp47 = localeToBcp47(locale);
  const fmtTime = (iso: string) =>
    formatInZone(iso, tz, { hour: '2-digit', minute: '2-digit' }, bcp47);
  const fmtDayTime = (iso: string) =>
    formatInZone(iso, tz, { weekday: 'short', hour: '2-digit', minute: '2-digit' }, bcp47);
  // Warn, never block: the button then reads "Register anyway" (ruling 270).
  const { commitments, unchecked } = commitmentsOf(
    caller.schedule,
    t('publicApp.me.schedule.referee'),
  );
  const conflictFor = (session: Session): string | null => {
    const clash = clashOf(session, commitments);
    return clash && t('publicApp.me.workshops.conflictsWith', clashWords(clash, fmtTime));
  };
  const guestPersonId = guestPersonAt(me, eventInfo?.id ?? null);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-strong text-strong-foreground text-sm px-4 py-2 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      {/* Back links — to the workshop list and the event home */}
      <div className="flex flex-wrap items-center gap-2">
        <BackLink
          href={`/e/${eventSlug}/workshops`}
          label={t('publicApp.eventHome.section.workshops')}
        />
        <BackLink href={`/e/${eventSlug}/home`} label={t('publicApp.workshopDetail.eventHome')} />
      </div>

      {/* Shared event identity band — matches the event home page. */}
      {eventInfo && <EventHeader event={eventInfo} locale={locale} eventSlug={eventSlug} />}

      {/* Workshop content — readable column with a left color band when set. */}
      <section className={`relative max-w-3xl ${workshop.color ? 'pl-4' : ''}`}>
        {workshop.color && (
          <span
            aria-hidden="true"
            className={`absolute inset-y-0 left-0 w-1 rounded ${accentClassFor(workshop.color)}`}
          />
        )}

        <WorkshopIntro workshop={workshop} />

        {/* Sessions */}
        <section>
          <h2
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: 'var(--color-accent)' }}
          >
            {t('publicApp.workshopDetail.sessions')}
          </h2>
          <div className="flex flex-col gap-3">
            {readFailed && <BookingsUnread onRetry={load} />}
            <ClashCheckNotice count={unchecked} />
            {sessions.map((session) => {
              if (isCancelledSession(session)) {
                return (
                  <div
                    key={session.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-border bg-surface p-4"
                  >
                    <SessionWhen
                      session={session}
                      timezone={tz}
                      bcp47={bcp47}
                      enrolled={null}
                      cancelled
                    />
                    <CancelledBadge t={t} />
                  </div>
                );
              }
              const cap = session.capacity ?? 0;
              const isFull = cap > 0 && session.confirmedCount >= cap;
              const booking = caller.bookings.get(session.id) ?? 'none';

              return (
                <div
                  key={session.id}
                  className="rounded-xl border border-border bg-surface p-4 shadow-sm"
                >
                  <div className="flex flex-col gap-3">
                    <SessionWhen
                      session={session}
                      timezone={tz}
                      bcp47={bcp47}
                      enrolled={
                        cap > 0
                          ? t('publicApp.workshopDetail.enrolledCount', {
                              confirmed: session.confirmedCount,
                              capacity: cap,
                            })
                          : null
                      }
                    />

                    <WorkshopRegisterControls
                      booking={booking}
                      full={isFull}
                      conflict={conflictFor(session)}
                      busy={busy.has(session.id)}
                      isInstructor={workshop.viewerIsInstructor}
                      placeElsewhere={placeElsewhereWords(
                        sessions,
                        session.id,
                        caller.bookings,
                        t,
                        fmtDayTime,
                      )}
                      labels={labels}
                      onRegister={() => void act(session.id, 'book', booking)}
                      onCancel={() => void act(session.id, 'cancel', booking)}
                    />
                  </div>
                </div>
              );
            })}
            {unknown && (
              <UnknownCallerNotice
                who={unknown.who}
                eventSlug={eventSlug}
                join={join}
                onJoined={() => act(unknown.sessionId, 'book', unknown.booking)}
              />
            )}
            {guestPersonId && <GuestAlertsLine eventSlug={eventSlug} personId={guestPersonId} />}
          </div>
        </section>
      </section>
    </main>
  );
}
