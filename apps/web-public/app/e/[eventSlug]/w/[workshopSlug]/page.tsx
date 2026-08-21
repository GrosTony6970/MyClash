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
import { apiRequest, failureCode, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { BackLink } from '@/components/BackLink';
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
  /** The signed-in caller teaches this workshop — no participant seat for them. */
  viewerIsInstructor: boolean;
}

/** Read twice — the first load, and the refresh after an enrolment lands. */
function workshopPath(workshopSlug: string, eventSlug: string): string {
  return `/api/v1/workshops/slug/${encodeURIComponent(workshopSlug)}?eventSlug=${encodeURIComponent(eventSlug)}`;
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
    // The route is public, but the seam sends the session anyway: it is what
    // lets the response carry `viewerIsInstructor` for the register button.
    void apiRequest<Workshop>(apiUrl, workshopPath(workshopSlug, eventSlug), {
      signal: controller.signal,
    }).then((result) => {
      // An abort means this effect was replaced, so the state it would set
      // belongs to a screen that is gone.
      if (result.ok) setWorkshop(result.data);
      else if (result.kind === 'aborted') return;
      setLoading(false);
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
      const result = await apiRequest<{ status: string }>(
        apiUrl,
        `/api/v1/workshop-sessions/${sessionId}/enroll`,
        { method: 'POST' },
      );

      if (result.ok) {
        setToast(
          result.data.status === 'waitlisted'
            ? t('publicApp.workshopDetail.addedToWaitlist')
            : t('publicApp.workshopDetail.enrolledSuccess'),
        );
        setTimeout(() => setToast(null), 3000);

        const refreshed = await apiRequest<Workshop>(apiUrl, workshopPath(workshopSlug, eventSlug));
        if (refreshed.ok) setWorkshop(refreshed.data);
        return;
      }

      // The API answers in English, so the one case the button cannot pre-empt
      // — a guest session, or a page loaded before the instructor tag was added
      // — is translated here. Matched on the code rather than the sentence.
      const refusal =
        failureCode(result) === 'INSTRUCTOR_SELF_ENROLLMENT'
          ? t('publicApp.workshopDetail.instructorCannotEnroll')
          : failureMessage(result, t, t('publicApp.workshopDetail.enrollmentFailed'));
      if (refusal) {
        setToast(refusal);
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
            {workshop.sessions.map((session) => {
              const cap = session.capacity ?? 0;
              const isFull = cap > 0 && session.confirmedCount >= cap;
              const enrolled = session.enrollmentStatus;

              return (
                <div
                  key={session.id}
                  className="rounded-xl border border-border bg-surface p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
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

                    <div className="flex-shrink-0">
                      {enrolled === 'confirmed' ? (
                        <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                          {t('publicApp.workshopDetail.enrolled')}
                        </span>
                      ) : enrolled === 'waitlisted' ? (
                        <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                          {t('publicApp.workshopDetail.waitlisted')}
                        </span>
                      ) : workshop.viewerIsInstructor ? (
                        // Teaching it means no participant seat; the API rejects
                        // the enroll too, this just says so up front.
                        <Button type="button" variant="secondary" size="sm" disabled>
                          {t('publicApp.workshopDetail.youTeachThis')}
                        </Button>
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
