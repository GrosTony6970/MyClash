'use client';

/**
 * Public person profile — T-611
 * Route: /e/[eventSlug]/people/[personId]
 *
 * Sections: header, today's items, full schedule, results.
 * Follow button with anonymous/guest/claimed behavior.
 * Respects allow_being_followed privacy setting.
 */

import { useCallback, useEffect, useState } from 'react';
import { getApiUrl } from '@/lib/api-url';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useI18n } from '../../../../../src/i18n/I18nProvider';

interface PersonProfile {
  id: string;
  givenName: string;
  familyName: string;
  clubLabel: string | null;
  roles: string[];
  allowBeingFollowed: boolean;
  followState: 'following' | 'not_following';
}

interface ScheduleMatch {
  id: string;
  matchNumberLabel: string;
  status: string;
  scheduledAt: string | null;
  opponentName: string | null;
  redScore: number;
  blueScore: number;
  isRed: boolean;
  tournamentName: string | null;
}

interface PersonSchedule {
  matches: ScheduleMatch[];
  refereeSlots: Array<{
    matchId: string;
    matchNumberLabel: string;
    scheduledAt: string | null;
    role: string;
  }>;
  workshops: Array<{
    workshopName: string;
    sessionStart: string | null;
    location: string | null;
  }> | null;
}

export default function PersonProfilePage() {
  const { t } = useI18n();
  const params = useParams<{ eventSlug: string; personId: string }>();
  const { eventSlug, personId } = params;
  const apiUrl = getApiUrl();

  const [profile, setProfile] = useState<PersonProfile | null>(null);
  const [schedule, setSchedule] = useState<PersonSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  // "This is me" claim CTA — only for viewers without a full account session.
  const [canClaim, setCanClaim] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [profileRes, scheduleRes] = await Promise.all([
          fetch(`${apiUrl}/api/v1/events/${eventSlug}/persons/${personId}`, {
            credentials: 'include',
          }),
          fetch(`${apiUrl}/api/v1/events/${eventSlug}/people/${personId}/schedule`, {
            credentials: 'include',
          }),
        ]);

        if (profileRes.ok) {
          const p = (await profileRes.json()) as PersonProfile;
          setProfile(p);
          setFollowing(p.followState === 'following');
        }
        if (scheduleRes.ok) setSchedule((await scheduleRes.json()) as PersonSchedule);
        setCanClaim(!document.cookie.includes('sb-access-token='));
      } catch {
        // Keep loading state
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [eventSlug, personId, apiUrl]);

  const handleFollow = useCallback(async () => {
    // Anonymous: localStorage + toast
    const hasCookie =
      document.cookie.includes('mc_guest=') || document.cookie.includes('sb-access-token=');

    if (!hasCookie) {
      const key = `follows:${eventSlug}`;
      const stored = JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
      if (!stored.includes(personId)) {
        localStorage.setItem(key, JSON.stringify([...stored, personId]));
      }
      setFollowing(true);
      setToast(t('publicApp.following.savedLocally'));
      setTimeout(() => setToast(null), 4000);
      return;
    }

    // Guest/claimed: server call
    setFollowLoading(true);
    try {
      if (following) {
        await fetch(`${apiUrl}/api/v1/events/${eventSlug}/follows/${personId}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        setFollowing(false);
      } else {
        await fetch(`${apiUrl}/api/v1/events/${eventSlug}/follows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ personId }),
        });
        setFollowing(true);
      }
    } catch {
      setToast(t('publicApp.following.followUpdateError'));
      setTimeout(() => setToast(null), 3000);
    } finally {
      setFollowLoading(false);
    }
  }, [following, eventSlug, personId, apiUrl, t]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="w-8 h-8 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <p className="text-4xl mb-3">👤</p>
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-white mb-2">
            {t('publicApp.following.personNotFound')}
          </h1>
        </div>
      </main>
    );
  }

  const live = schedule?.matches.filter((m) => m.status === 'running') ?? [];
  const upcoming = schedule?.matches.filter((m) => m.status === 'scheduled') ?? [];
  const past = schedule?.matches.filter((m) => m.status === 'completed') ?? [];

  return (
    <main className="px-4 py-6 max-w-lg mx-auto">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-800 border border-gray-700 text-white text-sm px-4 py-2 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-white">
            {profile.givenName} {profile.familyName}
          </h1>
          {profile.clubLabel && <p className="text-gray-400 text-sm mt-0.5">{profile.clubLabel}</p>}
          {profile.roles.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {profile.roles.map((r) => (
                <span
                  key={r}
                  className="text-xs px-2 py-0.5 rounded-full border bg-gray-800 text-gray-300 border-gray-700"
                >
                  {r.replace('_', ' ')}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Follow button */}
        {profile.allowBeingFollowed ? (
          <button
            onClick={() => void handleFollow()}
            disabled={followLoading}
            className={[
              'flex-shrink-0 px-4 py-2 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50',
              following
                ? 'bg-gray-800 border border-gray-600 text-gray-300 hover:border-red-600 hover:text-red-400'
                : 'text-white',
            ].join(' ')}
            style={!following ? { backgroundColor: 'var(--event-primary, #c0392b)' } : {}}
          >
            {following
              ? t('publicApp.following.followingButton')
              : t('publicApp.following.followButton')}
          </button>
        ) : (
          <p className="text-xs text-gray-600 flex-shrink-0 max-w-[120px] text-right">
            {t('publicApp.following.prefersNotFollowed')}
          </p>
        )}
      </div>

      {/* "This is me" — entry point into the event-scoped claim flow (the
          claim page's ?personId= URL previously had no producer at all). */}
      {canClaim && (
        <Link
          href={`/e/${eventSlug}/claim?personId=${profile.id}&next=${encodeURIComponent(`/e/${eventSlug}`)}`}
          className="mb-6 block rounded-xl border border-dashed border-gray-600 bg-gray-900 px-4 py-3 text-sm text-gray-300 transition-colors hover:border-gray-400"
        >
          <span className="font-semibold text-white">{t('publicApp.people.thisIsMeTitle')}</span>{' '}
          {t('publicApp.people.thisIsMeHint')}
        </Link>
      )}

      {/* Live now */}
      {live.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-red-400 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            {t('publicApp.fighterProfile.liveNow')}
          </h2>
          {live.map((m) => (
            <Link key={m.id} href={`/e/${eventSlug}/match/${m.id}`}>
              <div className="rounded-xl border-2 border-red-700 bg-red-950/30 p-4 mb-2">
                <p className="text-xs text-gray-400 mb-1">{m.matchNumberLabel}</p>
                <p className="font-bold text-white">
                  {t('publicApp.following.vsOpponent', { name: m.opponentName ?? '?' })}
                </p>
              </div>
            </Link>
          ))}
        </section>
      )}

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <section className="mb-6">
          <h2
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: 'var(--event-accent, #f59e0b)' }}
          >
            {t('publicApp.following.upcoming')}
          </h2>
          <div className="flex flex-col gap-2">
            {upcoming.map((m) => (
              <Link key={m.id} href={`/e/${eventSlug}/match/${m.id}`}>
                <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 hover:border-gray-600 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-white">
                      {t('publicApp.following.vsOpponent', { name: m.opponentName ?? '?' })}
                    </p>
                    <p className="text-xs text-gray-500">{m.matchNumberLabel}</p>
                  </div>
                  {m.scheduledAt && (
                    <p className="text-xs text-gray-400">
                      {new Date(m.scheduledAt).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Referee slots */}
      {schedule?.refereeSlots && schedule.refereeSlots.length > 0 && (
        <section className="mb-6">
          <h2
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: 'var(--event-accent, #f59e0b)' }}
          >
            {t('publicApp.following.refereeDuties')}
          </h2>
          <div className="flex flex-col gap-2">
            {schedule.refereeSlots.map((s) => (
              <div
                key={s.matchId}
                className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-white">{s.matchNumberLabel}</p>
                  <p className="text-xs text-gray-500">{s.role.replace('_', ' ')}</p>
                </div>
                {s.scheduledAt && (
                  <p className="text-xs text-gray-400">
                    {new Date(s.scheduledAt).toLocaleTimeString('fr-FR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Past results */}
      {past.length > 0 && (
        <section>
          <h2
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: 'var(--event-accent, #f59e0b)' }}
          >
            {t('publicApp.following.results')}
          </h2>
          <div className="flex flex-col gap-2">
            {past.map((m) => {
              const myScore = m.isRed ? m.redScore : m.blueScore;
              const oppScore = m.isRed ? m.blueScore : m.redScore;
              const won = myScore > oppScore;
              return (
                <Link key={m.id} href={`/e/${eventSlug}/match/${m.id}`}>
                  <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 hover:border-gray-600 transition-colors">
                    <div>
                      <p className="text-sm font-medium text-white">
                        {t('publicApp.following.vsOpponent', { name: m.opponentName ?? '?' })}
                      </p>
                      <p className="text-xs text-gray-500">{m.matchNumberLabel}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={[
                          'text-xs font-bold px-2 py-0.5 rounded-full',
                          won ? 'bg-green-900 text-green-300' : 'bg-red-900/50 text-red-400',
                        ].join(' ')}
                      >
                        {won
                          ? t('publicApp.following.resultWin')
                          : t('publicApp.following.resultLoss')}
                      </span>
                      <p className="text-sm font-mono font-bold text-white tabular-nums">
                        {myScore}–{oppScore}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
