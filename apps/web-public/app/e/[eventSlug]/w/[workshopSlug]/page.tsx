/* eslint-disable myclash/no-literal-string -- pre-T-1401 page; new OAuth strings use @myclash/i18n */
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
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import { createOAuthSupabaseClient } from '../../../../../src/lib/oauth-supabase';

interface Session {
  id: string;
  startTime: string;
  endTime: string;
  location: string | null;
  capacity: number;
  confirmedCount: number;
  enrollmentStatus?: 'confirmed' | 'waitlisted' | null;
}

interface Workshop {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  level: string | null;
  language: string | null;
  locationLabel: string | null;
  workshopSessions: Session[];
  workshopInstructors: Array<{
    persons: {
      id: string;
      givenName: string;
      familyName: string;
      clubLabel: string | null;
    } | null;
  }>;
}

export default function WorkshopDetailPage() {
  const { t } = useI18n();
  const params = useParams<{ eventSlug: string; workshopSlug: string }>();
  const searchParams = useSearchParams();
  const { eventSlug, workshopSlug } = params;
  const apiUrl = getApiUrl();

  const [workshop, setWorkshop] = useState<Workshop | null>(null);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const personId = searchParams.get('personId');

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
      setToast('Sign in to enroll in workshops.');
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
        const msg = data.status === 'waitlisted' ? 'Added to waitlist' : 'Enrolled successfully';
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
        setToast(body.message ?? 'Enrollment failed');
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
          <h1 className="text-xl font-bold text-gray-900 mb-2">Workshop not found</h1>
          <Link
            href={`/e/${eventSlug}/workshops`}
            className="text-sm text-gray-500 hover:underline"
          >
            ← Back to workshops
          </Link>
        </div>
      </main>
    );
  }

  const instructors = workshop.workshopInstructors.map((i) => i.persons).filter(Boolean);

  return (
    <main className="px-4 py-6 max-w-lg mx-auto">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm px-4 py-2 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      {/* Back */}
      <Link
        href={`/e/${eventSlug}/workshops`}
        className="text-sm text-gray-500 hover:text-gray-700 mb-4 inline-block"
      >
        ← Workshops
      </Link>

      {/* Header */}
      <h1
        className="text-2xl font-bold mb-1"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--event-primary, #c0392b)' }}
      >
        {workshop.name}
      </h1>

      {/* Instructors */}
      {instructors.length > 0 && (
        <p className="text-gray-500 text-sm mb-3">
          {instructors.map((i) => `${i!.givenName} ${i!.familyName}`).join(', ')}
          {instructors[0]?.clubLabel && ` · ${instructors[0].clubLabel}`}
        </p>
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
        {workshop.locationLabel && (
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
            📍 {workshop.locationLabel}
          </span>
        )}
      </div>

      {/* Description */}
      {workshop.description && (
        <p className="text-gray-600 text-sm leading-relaxed mb-6">{workshop.description}</p>
      )}

      {personId && (
        <button
          type="button"
          onClick={() => {
            void handleGoogleClaim();
          }}
          className="w-full mb-6 border border-gray-300 hover:border-red-500 text-gray-800 font-semibold py-2 px-4 rounded-md transition-colors"
        >
          {t('auth.oauth.continueWithGoogle')}
        </button>
      )}

      {/* Sessions */}
      <section>
        <h2
          className="text-xs font-bold uppercase tracking-widest mb-3"
          style={{ color: 'var(--event-accent, #f59e0b)' }}
        >
          Sessions
        </h2>
        <div className="flex flex-col gap-3">
          {workshop.workshopSessions.map((session) => {
            const isFull = session.confirmedCount >= session.capacity;
            const enrolled = session.enrollmentStatus;

            return (
              <div key={session.id} className="border border-gray-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900">
                      {new Date(session.startTime).toLocaleDateString('fr-FR', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </p>
                    <p className="text-sm text-gray-500">
                      {new Date(session.startTime).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      –{' '}
                      {new Date(session.endTime).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {session.location && ` · ${session.location}`}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {session.confirmedCount}/{session.capacity} enrolled
                    </p>
                  </div>

                  <div className="flex-shrink-0">
                    {enrolled === 'confirmed' ? (
                      <span className="text-xs font-bold text-green-600 bg-green-50 px-3 py-1.5 rounded-lg">
                        ✓ Enrolled
                      </span>
                    ) : enrolled === 'waitlisted' ? (
                      <span className="text-xs font-bold text-yellow-600 bg-yellow-50 px-3 py-1.5 rounded-lg">
                        Waitlisted
                      </span>
                    ) : (
                      <button
                        onClick={() => void handleEnroll(session.id)}
                        disabled={enrolling === session.id}
                        className="text-sm font-semibold px-4 py-1.5 rounded-lg text-white disabled:opacity-50 transition-colors"
                        style={{
                          backgroundColor: isFull ? '#6b7280' : 'var(--event-primary, #c0392b)',
                        }}
                      >
                        {enrolling === session.id
                          ? '…'
                          : isFull
                            ? 'Join waitlist'
                            : 'Add to schedule'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
