'use client';

/**
 * Workshop detail — T-803
 * Route: /e/[eventSlug]/w/[workshopSlug]
 *
 * AC:
 *   ✓ Sessions, capacity status, "Add to my schedule" button
 *   ✓ Anonymous can browse; enroll requires login
 */

import { useEffect, useState } from 'react';
import { getApiUrl } from '@/lib/api-url';
import { BackLink } from '@/components/BackLink';
import { useParams, useSearchParams } from 'next/navigation';
import { formatInZone } from '@myclash/time';
import { Button, GoogleIcon, TournamentColorDot, accentClassFor } from '@myclash/ui';
import { EventHeader, fetchEventInfo, type EventInfo } from '../../_components/EventHeader';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import { createOAuthSupabaseClient } from '../../../../../src/lib/oauth-supabase';

interface Session {
  id: string;
  startsAt: string | null;
  endsAt: string | null;
  locationLabel: string | null;
  capacity: number | null;
  confirmedCount: number;
  enrollmentStatus?: 'confirmed' | 'waitlisted' | null;
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
}

export default function WorkshopDetailPage() {
  const { t } = useI18n();
  const params = useParams<{ eventSlug: string; workshopSlug: string }>();
  const searchParams = useSearchParams();
  const { eventSlug, workshopSlug } = params;
  const apiUrl = getApiUrl();

  const [workshop, setWorkshop] = useState<Workshop | null>(null);
  const [eventInfo, setEventInfo] = useState<EventInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState<string | null>(null);
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

  useEffect(() => {
    const controller = new AbortController();
    fetch(
      `${apiUrl}/api/v1/workshops/slug/${encodeURIComponent(workshopSlug)}?eventSlug=${encodeURIComponent(eventSlug)}`,
      {
        signal: controller.signal,
      },
    )
      .then(async (res) => {
        setLoading(false);
        if (res.ok) setWorkshop((await res.json()) as Workshop);
      })
      .catch((err: unknown) => {
        setLoading(false);
        if (err instanceof Error && err.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [workshopSlug, eventSlug, apiUrl]);

  async function handleEnroll(sessionId: string) {
    const hasCookie =
      document.cookie.includes('mc_guest=') || document.cookie.includes('sb-access-token=');

    if (!hasCookie) {
      setToast(t('publicApp.workshopDetail.signInToEnroll'));
      setTimeout(() => setToast(null), 3000);
      return;
    }

    setEnrolling(sessionId);
    try {
      const res = await fetch(`${apiUrl}/api/v1/workshop-sessions/${sessionId}/enroll`, {
        method: 'POST',
        credentials: 'include',
      });

      if (res.ok) {
        const data = (await res.json()) as { status: string };
        const msg =
          data.status === 'waitlisted'
            ? t('publicApp.workshopDetail.addedToWaitlist')
            : t('publicApp.workshopDetail.enrolledSuccess');
        setToast(msg);
        setTimeout(() => setToast(null), 3000);

        // Refresh workshop data
        const refreshRes = await fetch(
          `${apiUrl}/api/v1/workshops/slug/${encodeURIComponent(workshopSlug)}?eventSlug=${encodeURIComponent(eventSlug)}`,
          { credentials: 'include' },
        );
        if (refreshRes.ok) setWorkshop((await refreshRes.json()) as Workshop);
      } else {
        const body = (await res.json()) as { message?: string };
        setToast(body.message ?? t('publicApp.workshopDetail.enrollmentFailed'));
        setTimeout(() => setToast(null), 3000);
      }
    } finally {
      setEnrolling(null);
    }
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
        <span className="w-8 h-8 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  if (!workshop) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <p className="text-4xl mb-3">📚</p>
          <h1 className="mb-3 font-display text-2xl font-bold text-gray-900 sm:text-3xl">
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

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm px-4 py-2 rounded-xl shadow-lg">
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
      {eventInfo && <EventHeader event={eventInfo} />}

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
          style={{ color: 'var(--event-primary, #c0392b)' }}
        >
          <TournamentColorDot color={workshop.color} size="md" />
          {workshop.title}
        </h1>

        {/* Instructors */}
        {instructorNames.length > 0 && (
          <p className="text-gray-500 text-sm mb-3">{instructorNames.join(', ')}</p>
        )}

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {workshop.category && (
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              {workshop.category}
            </span>
          )}
          {workshop.level && (
            <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
              {workshop.level}
            </span>
          )}
          {workshop.language && (
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
              {workshop.language.toUpperCase()}
            </span>
          )}
          {workshop.durationMinutes != null && (
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
              {t('publicApp.workshops.durationMinutes', { count: workshop.durationMinutes })}
            </span>
          )}
        </div>

        {/* Description — paragraphs/line breaks preserved */}
        {description && (
          <div className="prose prose-sm mb-6 max-w-none whitespace-pre-line text-sm leading-relaxed text-gray-600">
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
            style={{ color: 'var(--event-accent, #f59e0b)' }}
          >
            {t('publicApp.workshopDetail.sessions')}
          </h2>
          <div className="flex flex-col gap-3">
            {workshop.sessions.map((session) => {
              const cap = session.capacity ?? 0;
              const isFull = cap > 0 && session.confirmedCount >= cap;
              const enrolled = session.enrollmentStatus;

              return (
                <div
                  key={session.id}
                  className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      {session.startsAt && (
                        <p className="font-medium text-gray-900">
                          {formatInZone(session.startsAt, tz, {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                          })}
                        </p>
                      )}
                      {(session.startsAt || session.endsAt || session.locationLabel) && (
                        <p className="text-sm text-gray-500">
                          {session.startsAt &&
                            formatInZone(session.startsAt, tz, {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          {session.startsAt && session.endsAt && ' – '}
                          {session.endsAt &&
                            formatInZone(session.endsAt, tz, {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          {session.locationLabel && ` · ${session.locationLabel}`}
                        </p>
                      )}
                      {cap > 0 && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {t('publicApp.workshopDetail.enrolledCount', {
                            confirmed: session.confirmedCount,
                            capacity: cap,
                          })}
                        </p>
                      )}
                    </div>

                    <div className="flex-shrink-0">
                      {enrolled === 'confirmed' ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          {t('publicApp.workshopDetail.enrolled')}
                        </span>
                      ) : enrolled === 'waitlisted' ? (
                        <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                          {t('publicApp.workshopDetail.waitlisted')}
                        </span>
                      ) : (
                        <Button
                          type="button"
                          variant={isFull ? 'secondary' : 'primary'}
                          size="sm"
                          onClick={() => void handleEnroll(session.id)}
                          loading={enrolling === session.id}
                        >
                          {isFull
                            ? t('publicApp.workshopDetail.joinWaitlist')
                            : t('publicApp.workshopDetail.addToSchedule')}
                        </Button>
                      )}
                    </div>
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
