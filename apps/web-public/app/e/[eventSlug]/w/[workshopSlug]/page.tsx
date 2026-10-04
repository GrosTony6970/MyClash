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
 */

import { useCallback, useEffect, useState } from 'react';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { BackLink } from '@/components/BackLink';
import { WorkshopRegisterControls, registerLabels } from '@/components/me/WorkshopRegisterControls';
import {
  changeBooking,
  readBookings,
  type BookingChange,
  type WorkshopBooking,
} from '@/components/me/workshop-booking';
import { useParams, useSearchParams } from 'next/navigation';
import { formatInZone, localeToBcp47 } from '@myclash/time';
import { Button, GoogleIcon, TournamentColorDot, accentClassFor } from '@myclash/ui';
import { EventHeader, fetchEventInfo, type EventInfo } from '../../_components/EventHeader';
import { useI18n } from '@myclash/next-i18n/client';
import { createOAuthSupabaseClient } from '../../../../../src/lib/oauth-supabase';

interface Session {
  id: string;
  startsAt: string | null;
  endsAt: string | null;
  locationLabel: string | null;
  capacity: number | null;
  confirmedCount: number;
  /** 'scheduled' | 'running' | 'completed' | 'cancelled' */
  status: string;
}

interface Workshop {
  id: string;
  slug: string;
  title: string;
  shortDescription: string | null;
  descriptionMd: string | null;
  category: string | null;
  level: string | null;
  language: string | null;
  color: string | null;
  durationMinutes: number | null;
  eventTimezone: string | null;
  sessions: Session[];
  instructors: Array<{ globalPersonId: string | null; displayName: string }>;
  /** The signed-in caller teaches this workshop — no participant seat for them. */
  viewerIsInstructor: boolean;
}

/** Read at the first load, and again after every tap on a session. */
function workshopPath(workshopSlug: string, eventSlug: string): string {
  return `/api/v1/workshops/slug/${encodeURIComponent(workshopSlug)}?eventSlug=${encodeURIComponent(eventSlug)}`;
}

/**
 * What the page says after a tap: the booking as the server gave it, or why it
 * was refused. Nothing after a booking given up: the session's row says it.
 */
function changeNotice(change: BookingChange, t: (key: string) => string): string | null {
  if (change.ok) {
    if (change.status === 'cancelled') return null;
    return change.status === 'waitlisted'
      ? t('publicApp.workshopDetail.addedToWaitlist')
      : t('publicApp.workshopDetail.enrolledSuccess');
  }
  const refusals = {
    nobody: t('publicApp.workshopDetail.signInToEnroll'),
    teaches: t('publicApp.workshopDetail.instructorCannotEnroll'),
    removed: t('publicApp.me.workshops.refused'),
    other: failureMessage(change.failure, t),
  };
  return refusals[change.why];
}

export default function WorkshopDetailPage() {
  const { t, locale } = useI18n();
  const params = useParams<{ eventSlug: string; workshopSlug: string }>();
  const searchParams = useSearchParams();
  const { eventSlug, workshopSlug } = params;
  const apiUrl = getPublicApiUrl();

  const [workshop, setWorkshop] = useState<Workshop | null>(null);
  const [eventInfo, setEventInfo] = useState<EventInfo | null>(null);
  const [loading, setLoading] = useState(true);
  // Session id → what the caller's booking of it is. Empty for nobody.
  const [bookings, setBookings] = useState<Map<string, WorkshopBooking>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [loadKey, setLoadKey] = useState(0);
  const load = useCallback(() => setLoadKey((key) => key + 1), []);
  const [toast, setToast] = useState<string | null>(null);
  const personId = searchParams.get('personId');

  // Event identity for the shared header band — mirrors the event home page.
  useEffect(() => {
    let cancelled = false;
    void fetchEventInfo(eventSlug, apiUrl).then((info) => {
      if (!cancelled) setEventInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, [eventSlug, apiUrl]);

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
        setLoading(false);
      },
    );
    // A read that failed (or was aborted) is no verdict: the page keeps what it shows.
    void readBookings(apiUrl, eventSlug, signal).then((read) => {
      if (read) setBookings(read);
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
    setBusy(sessionId);
    const change = await changeBooking(apiUrl, sessionId, action, booking);
    setBusy(null);
    say(changeNotice(change, t));
    load();
  }

  async function handleGoogleClaim() {
    if (!personId) {
      setToast(t('auth.oauth.errors.personMissing'));
      setTimeout(() => setToast(null), 3000);
      return;
    }
    const next = `/e/${eventSlug}/w/${workshopSlug}`;
    const redirectTo = `${window.location.origin}/auth/oauth/callback?mode=person_claim&personId=${encodeURIComponent(personId)}&next=${encodeURIComponent(next)}`;
    const { error } = await createOAuthSupabaseClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) {
      setToast(t('auth.oauth.errors.startFailed'));
      setTimeout(() => setToast(null), 3000);
    }
  }

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
            {t('publicApp.workshopDetail.notFound')}
          </h1>
          <BackLink
            href={`/e/${eventSlug}/workshops`}
            label={t('publicApp.eventHome.section.workshops')}
            className="mx-auto"
          />
        </div>
      </main>
    );
  }

  const instructorNames = workshop.instructors.map((i) => i.displayName);
  const description = workshop.descriptionMd ?? workshop.shortDescription;
  const tz = workshop.eventTimezone ?? 'Europe/Paris';
  const labels = registerLabels(t);
  // A cancelled session is not listed, as on the personal Workshops page: it has
  // nothing to book, and the API does not refuse a booking of one.
  const sessions = workshop.sessions.filter((session) => session.status !== 'cancelled');

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

        {/* Header */}
        <h1
          className="mb-1 flex items-center gap-2 font-display text-2xl font-bold sm:text-3xl"
          style={{ color: 'var(--color-accent)' }}
        >
          <TournamentColorDot color={workshop.color} size="md" />
          {workshop.title}
        </h1>

        {/* Instructors */}
        {instructorNames.length > 0 && (
          <p className="text-muted text-sm mb-3">{instructorNames.join(', ')}</p>
        )}

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {workshop.category && (
            <span className="text-xs bg-border text-foreground-secondary px-2 py-0.5 rounded-full">
              {workshop.category}
            </span>
          )}
          {workshop.level && (
            <span className="text-xs bg-info/10 text-info px-2 py-0.5 rounded-full">
              {workshop.level}
            </span>
          )}
          {workshop.language && (
            <span className="text-xs bg-border text-muted px-2 py-0.5 rounded-full">
              {workshop.language.toUpperCase()}
            </span>
          )}
          {workshop.durationMinutes != null && (
            <span className="text-xs bg-border text-muted px-2 py-0.5 rounded-full">
              {t('publicApp.workshops.durationMinutes', { count: workshop.durationMinutes })}
            </span>
          )}
        </div>

        {/* Description — paragraphs/line breaks preserved */}
        {description && (
          <div className="prose prose-sm mb-6 max-w-none whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">
            {description}
          </div>
        )}

        {personId && (
          <Button
            type="button"
            variant="back"
            size="md"
            onClick={() => {
              void handleGoogleClaim();
            }}
            leftIcon={<GoogleIcon />}
            className="mb-6 w-full"
          >
            {t('auth.oauth.continueWithGoogle')}
          </Button>
        )}

        {/* Sessions */}
        <section>
          <h2
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: 'var(--color-accent)' }}
          >
            {t('publicApp.workshopDetail.sessions')}
          </h2>
          <div className="flex flex-col gap-3">
            {sessions.map((session) => {
              const cap = session.capacity ?? 0;
              const isFull = cap > 0 && session.confirmedCount >= cap;
              const booking = bookings.get(session.id) ?? 'none';

              return (
                <div
                  key={session.id}
                  className="rounded-xl border border-border bg-surface p-4 shadow-sm"
                >
                  <div className="flex flex-col gap-3">
                    <div>
                      {session.startsAt && (
                        <p className="font-medium text-foreground">
                          {formatInZone(
                            session.startsAt,
                            tz,
                            {
                              weekday: 'short',
                              day: 'numeric',
                              month: 'short',
                            },
                            localeToBcp47(locale),
                          )}
                        </p>
                      )}
                      {(session.startsAt || session.endsAt || session.locationLabel) && (
                        <p className="text-sm text-muted">
                          {session.startsAt &&
                            formatInZone(
                              session.startsAt,
                              tz,
                              {
                                hour: '2-digit',
                                minute: '2-digit',
                              },
                              localeToBcp47(locale),
                            )}
                          {session.startsAt && session.endsAt && ' – '}
                          {session.endsAt &&
                            formatInZone(
                              session.endsAt,
                              tz,
                              {
                                hour: '2-digit',
                                minute: '2-digit',
                              },
                              localeToBcp47(locale),
                            )}
                          {session.locationLabel && ` · ${session.locationLabel}`}
                        </p>
                      )}
                      {cap > 0 && (
                        <p className="text-xs text-muted mt-0.5">
                          {t('publicApp.workshopDetail.enrolledCount', {
                            confirmed: session.confirmedCount,
                            capacity: cap,
                          })}
                        </p>
                      )}
                    </div>

                    <WorkshopRegisterControls
                      booking={booking}
                      full={isFull}
                      busy={busy === session.id}
                      isInstructor={workshop.viewerIsInstructor}
                      labels={labels}
                      onRegister={() => void act(session.id, 'book', booking)}
                      onCancel={() => void act(session.id, 'cancel', booking)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}
