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
import { fetchMe } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { localeToBcp47 } from '@myclash/time';
import { LegalNotice } from '../../../../../src/components/LegalConsent';
import { useI18n } from '@myclash/next-i18n/client';

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
  /** Result from this person's perspective, decided server-side from the
   *  recorded winner. Null while the bout is unfinished. */
  outcome: 'win' | 'loss' | 'draw' | null;
  isRed: boolean;
  tournamentName: string | null;
}

interface PersonSchedule {
  matches: ScheduleMatch[];
  refereeSlots: Array<{
    /** referee_assignments.id — `matchId` is '' for every pool-scoped duty, so
     *  it cannot key the list. */
    id: string;
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
  const { t, locale } = useI18n();
  const params = useParams<{ eventSlug: string; personId: string }>();
  const { eventSlug, personId } = params;
  const apiUrl = getPublicApiUrl();

  const [profile, setProfile] = useState<PersonProfile | null>(null);
  const [schedule, setSchedule] = useState<PersonSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  // Viewer identity drives the "This is me" card: anonymous viewers get
  // claim + guest quick-access, guests get the claim upgrade, claimed users
  // get nothing. Defaults to 'claimed' so the card never flashes for
  // signed-in users while /me resolves.
  const [viewerType, setViewerType] = useState<'anonymous' | 'guest' | 'claimed'>('claimed');
  const [guestLoading, setGuestLoading] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [profileRes, scheduleRes, me] = await Promise.all([
          fetch(`${apiUrl}/api/v1/events/${eventSlug}/persons/${personId}`, {
            credentials: 'include',
          }),
          fetch(`${apiUrl}/api/v1/events/${eventSlug}/people/${personId}/schedule`, {
            credentials: 'include',
          }),
          fetchMe(apiUrl),
        ]);

        if (profileRes.ok) {
          const p = (await profileRes.json()) as PersonProfile;
          setProfile(p);
          setFollowing(p.followState === 'following');
        }
        if (scheduleRes.ok) setSchedule((await scheduleRes.json()) as PersonSchedule);
        // Unreadable /me falls through to the existing 'claimed' default, which
        // is what this did before: the viewer type only widens what the page
        // offers, and the API refuses anything they may not do.
        if (me.ok) {
          setViewerType(
            me.data.type === 'guest'
              ? 'guest'
              : me.data.type === 'anonymous'
                ? 'anonymous'
                : 'claimed',
          );
        }
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

  // Guest quick-access: participant picks themselves from the roster — the
  // API mints a guest_sessions row + mc_guest httpOnly cookie, unlocking
  // follows/my-schedule/workshops without an account. This flow was fully
  // built server-side but had NO entry point in any UI.
  const handleGuestAccess = useCallback(async () => {
    setGuestLoading(true);
    try {
      const evRes = await fetch(`${apiUrl}/api/v1/events/${encodeURIComponent(eventSlug)}`, {
        cache: 'no-store',
      });
      if (!evRes.ok) throw new Error('event');
      const ev = (await evRes.json()) as { id: string };
      const res = await fetch(`${apiUrl}/api/v1/events/${ev.id}/guest-sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ person_id: personId }),
      });
      if (!res.ok) throw new Error('guest');
      // Land on the (now guest-aware) personal event schedule.
      window.location.assign(`/e/${eventSlug}/my-schedule`);
    } catch {
      setToast(t('publicApp.people.guestAccessError'));
      setTimeout(() => setToast(null), 4000);
      setGuestLoading(false);
    }
  }, [apiUrl, eventSlug, personId, t]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="w-8 h-8 border-2 border-muted border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <p className="text-4xl mb-3">👤</p>
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground mb-2">
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
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-surface border border-border text-foreground text-sm px-4 py-2 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
            {profile.givenName} {profile.familyName}
          </h1>
          {profile.clubLabel && <p className="text-muted text-sm mt-0.5">{profile.clubLabel}</p>}
          {profile.roles.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {profile.roles.map((r) => (
                <span
                  key={r}
                  className="text-xs px-2 py-0.5 rounded-full border bg-border text-foreground-secondary border-border"
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
                ? 'bg-surface border border-border text-foreground-secondary hover:border-danger hover:text-danger'
                : 'text-white',
            ].join(' ')}
            style={!following ? { backgroundColor: 'var(--color-accent)' } : {}}
          >
            {following
              ? t('publicApp.following.followingButton')
              : t('publicApp.following.followButton')}
          </button>
        ) : (
          <p className="text-xs text-muted flex-shrink-0 max-w-[120px] text-right">
            {t('publicApp.following.prefersNotFollowed')}
          </p>
        )}
      </div>

      {/* "This is me" — entry points into the event-scoped claim flow (the
          claim page's ?personId= URL previously had no producer) and the
          guest-session quick access (previously unreachable server flow).
          Guests see only the claim upgrade; claimed users see nothing. */}
      {viewerType !== 'claimed' && (
        <div className="mb-6 rounded-xl border border-dashed border-border bg-surface px-4 py-3">
          <p className="text-sm text-foreground-secondary">
            <span className="font-semibold text-foreground">
              {t('publicApp.people.thisIsMeTitle')}
            </span>{' '}
            {t('publicApp.people.thisIsMeHint')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={`/e/${eventSlug}/claim?personId=${profile.id}&next=${encodeURIComponent(`/e/${eventSlug}`)}`}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              {t('publicApp.people.claimButton')}
            </Link>
            {viewerType === 'anonymous' && (
              <button
                type="button"
                onClick={() => void handleGuestAccess()}
                disabled={guestLoading}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground transition-colors hover:border-muted disabled:opacity-50"
              >
                {t('publicApp.people.guestAccessButton')}
              </button>
            )}
          </div>
          {/* Notice, not a gate: continuing as a guest hands over no new
              personal data — the roster row is already the organiser's — so a
              competitor looking up their own pool is informed, not blocked. */}
          <LegalNotice className="mt-3" />
        </div>
      )}

      {/* Live now */}
      {live.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-danger mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-danger animate-pulse" />
            {t('publicApp.fighterProfile.liveNow')}
          </h2>
          {live.map((m) => (
            <Link key={m.id} href={`/e/${eventSlug}/match/${m.id}`}>
              <div className="rounded-xl border-2 border-danger/40 bg-danger/10 p-4 mb-2">
                <p className="text-xs text-muted mb-1">{m.matchNumberLabel}</p>
                <p className="font-bold text-foreground">
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
            style={{ color: 'var(--color-accent)' }}
          >
            {t('publicApp.following.upcoming')}
          </h2>
          <div className="flex flex-col gap-2">
            {upcoming.map((m) => (
              <Link key={m.id} href={`/e/${eventSlug}/match/${m.id}`}>
                <div className="flex items-center justify-between bg-surface border border-border rounded-xl px-4 py-3 hover:border-muted transition-colors">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {t('publicApp.following.vsOpponent', { name: m.opponentName ?? '?' })}
                    </p>
                    <p className="text-xs text-muted">{m.matchNumberLabel}</p>
                  </div>
                  {m.scheduledAt && (
                    <p className="text-xs text-muted">
                      {new Date(m.scheduledAt).toLocaleTimeString(localeToBcp47(locale), {
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
            style={{ color: 'var(--color-accent)' }}
          >
            {t('publicApp.following.refereeDuties')}
          </h2>
          <div className="flex flex-col gap-2">
            {schedule.refereeSlots.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between bg-surface border border-border rounded-xl px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{s.matchNumberLabel}</p>
                  <p className="text-xs text-muted">{s.role.replace('_', ' ')}</p>
                </div>
                {s.scheduledAt && (
                  <p className="text-xs text-muted">
                    {new Date(s.scheduledAt).toLocaleTimeString(localeToBcp47(locale), {
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
            style={{ color: 'var(--color-accent)' }}
          >
            {t('publicApp.following.results')}
          </h2>
          <div className="flex flex-col gap-2">
            {past.map((m) => {
              const myScore = m.isRed ? m.redScore : m.blueScore;
              const oppScore = m.isRed ? m.blueScore : m.redScore;
              // Server-decided from the recorded winner. Comparing the two
              // numbers showed a loss for every bout won on the lower score —
              // a forfeit, a walkover, a referee_decision override — and, with
              // no third branch, for every draw as well.
              const outcome = m.outcome;
              return (
                <Link key={m.id} href={`/e/${eventSlug}/match/${m.id}`}>
                  <div className="flex items-center justify-between bg-surface border border-border rounded-xl px-4 py-3 hover:border-muted transition-colors">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {t('publicApp.following.vsOpponent', { name: m.opponentName ?? '?' })}
                      </p>
                      <p className="text-xs text-muted">{m.matchNumberLabel}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={[
                          'text-xs font-bold px-2 py-0.5 rounded-full',
                          outcome === 'win'
                            ? 'bg-success/10 text-success'
                            : outcome === 'draw'
                              ? 'bg-muted/10 text-muted'
                              : 'bg-danger/10 text-danger',
                        ].join(' ')}
                      >
                        {outcome === 'win'
                          ? t('publicApp.following.resultWin')
                          : outcome === 'draw'
                            ? t('publicApp.following.resultDraw')
                            : t('publicApp.following.resultLoss')}
                      </span>
                      <p className="text-sm font-mono font-bold text-foreground tabular-nums">
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
