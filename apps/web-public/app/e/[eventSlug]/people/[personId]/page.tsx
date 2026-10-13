'use client';

/**
 * Public person profile — T-611
 * Route: /e/[eventSlug]/people/[personId]
 *
 * Sections: header, today's items, full schedule, results.
 * Follow button: every tap asks the server, which decides who may follow (ruling 121b).
 * Respects allow_being_followed privacy setting.
 *
 * The API routes take the Event's id, not its slug: the page resolves it first.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiRequest, failureCode, fetchMe } from '@myclash/api-client';
import { useToast } from '@myclash/ui';
import { getPublicApiUrl } from '@/lib/api-url';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { DEFAULT_EVENT_TIMEZONE, formatInZone, localeToBcp47 } from '@myclash/time';
import { isLiveStatus } from '@myclash/types';
import { useI18n } from '@myclash/next-i18n/client';
import { fetchEventInfo } from '../../_components/EventHeader';
import { BackLink } from '@/components/BackLink';
import { boutPageHref } from '@/lib/bout-page';
import { refereeRoleLabel } from '@/components/me/referee-role';
import { followRefusal } from './follow-answer';
import { ThisIsMeCard } from './ThisIsMeCard';

interface PersonProfile {
  id: string;
  givenName: string;
  familyName: string;
  clubLabel: string | null;
  roles: Array<'competitor' | 'referee' | 'instructor'>;
  allowBeingFollowed: boolean;
  followState: 'following' | 'not_following';
  /** An account holds this roster name (ruling 269). */
  hasAccount: boolean;
}

const ROLE_LABEL_KEYS = {
  competitor: 'publicApp.following.roleCompetitor',
  referee: 'publicApp.following.roleReferee',
  instructor: 'publicApp.following.roleInstructor',
} as const;

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
  /** The piste the bout is planned on, when it has one. */
  liceName?: string | null;
}

/** A bout that is live or to come: its label, and where to go to watch it. */
const boutAndPiste = (m: ScheduleMatch): string =>
  m.liceName ? `${m.matchNumberLabel} · ${m.liceName}` : m.matchNumberLabel;

interface PersonSchedule {
  /** The Event's IANA zone: the clock the times below are told on. */
  timezone?: string | null;
  matches: ScheduleMatch[];
  refereeSlots: Array<{
    /** referee_assignments.id — `matchId` is '' for every pool-scoped duty, so
     *  it cannot key the list. */
    id: string;
    matchId: string;
    matchNumberLabel: string;
    scheduledAt: string | null;
    /** The organiser's own name for the duty's role; the role's id is not shown. */
    skillName?: string | null;
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
  const toast = useToast();

  const [eventId, setEventId] = useState<string | null>(null);
  const [profile, setProfile] = useState<PersonProfile | null>(null);
  const [schedule, setSchedule] = useState<PersonSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  // Viewer identity drives the "This is me" card: anonymous viewers get
  // claim + guest quick-access, guests get the claim upgrade, claimed users
  // get nothing. Defaults to 'claimed' so the card never flashes for
  // signed-in users while /me resolves.
  const [viewerType, setViewerType] = useState<'anonymous' | 'guest' | 'claimed'>('claimed');
  const [guestLoading, setGuestLoading] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const read = await fetchEventInfo(eventSlug, apiUrl, { credentials: 'include' });
        // An Event that is not there has no such person; a read that failed is a failure.
        if (read.kind === 'failed') setLoadFailed(true);
        if (read.kind !== 'found') return;
        const event = read.event;
        setEventId(event.id);
        const people = `/api/v1/events/${event.id}/people/${personId}`;
        const [profileRes, scheduleRes, me] = await Promise.all([
          apiRequest<PersonProfile>(apiUrl, people),
          apiRequest<PersonSchedule>(apiUrl, `${people}/schedule`),
          fetchMe(apiUrl),
        ]);

        if (profileRes.ok) {
          setProfile(profileRes.data);
          setFollowing(profileRes.data.followState === 'following');
        } else if (!(profileRes.kind === 'http' && profileRes.status === 404)) {
          // Only a 404 means "no such person here"; a 5xx or a dropped connection is a failure.
          setLoadFailed(true);
        }
        if (scheduleRes.ok) setSchedule(scheduleRes.data);
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
        setLoadFailed(true);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [eventSlug, personId, apiUrl]);

  // Every tap asks the server (ruling 121b): the login is an httpOnly cookie this page cannot
  // read, so the server is the only one who knows whether the viewer may follow.
  const handleFollow = useCallback(async () => {
    if (!eventId) return;
    setFollowLoading(true);
    const result = following
      ? await apiRequest(apiUrl, `/api/v1/events/${eventId}/follows/${personId}`, {
          method: 'DELETE',
        })
      : await apiRequest(apiUrl, `/api/v1/events/${eventId}/follows`, {
          method: 'POST',
          body: { personId },
        });
    setFollowLoading(false);
    const refusal = followRefusal(result);
    if (refusal) toast.error(t(refusal));
    else setFollowing(!following);
  }, [following, eventId, personId, apiUrl, t, toast]);

  // Guest quick-access: participant picks themselves from the roster — the
  // API mints a guest_sessions row + mc_guest httpOnly cookie, unlocking
  // follows/my-schedule/workshops without an account. This flow was fully
  // built server-side but had NO entry point in any UI.
  const handleGuestAccess = useCallback(async () => {
    if (!eventId) return;
    setGuestLoading(true);
    const result = await apiRequest(apiUrl, `/api/v1/events/${eventId}/guest-sessions`, {
      method: 'POST',
      body: { person_id: personId },
    });
    if (result.ok) {
      // Land on the (now guest-aware) personal event schedule.
      window.location.assign(`/e/${eventSlug}/my-schedule`);
      return;
    }
    // A name an account holds is not a guest's to pick (ruling 265): its holder signs in.
    toast.error(
      failureCode(result) === 'PERSON_HAS_ACCOUNT'
        ? t('publicApp.people.guestHasAccount')
        : t('publicApp.people.guestAccessError'),
    );
    setGuestLoading(false);
  }, [apiUrl, eventId, eventSlug, personId, t, toast]);

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
            {loadFailed
              ? t('publicApp.following.personLoadError')
              : t('publicApp.following.personNotFound')}
          </h1>
          <BackLink
            href={`/e/${eventSlug}/home`}
            label={t('publicApp.eventHome.backToHome')}
            className="mt-4"
          />
        </div>
      </main>
    );
  }

  // A time on the EVENT's clock: the phone of whoever follows may be on another.
  const tz = schedule?.timezone ?? DEFAULT_EVENT_TIMEZONE;
  const hallTime = (iso: string) =>
    formatInZone(iso, tz, { hour: '2-digit', minute: '2-digit' }, localeToBcp47(locale));

  // A bout's page, whose Back returns to this person's page.
  const boutHref = (m: ScheduleMatch) =>
    boutPageHref(eventSlug, m.id, `/e/${eventSlug}/people/${personId}`);

  // A bout whose clock is halted is still in play: it is live, not gone.
  const live = schedule?.matches.filter((m) => isLiveStatus(m.status)) ?? [];
  const upcoming = schedule?.matches.filter((m) => m.status === 'scheduled') ?? [];
  const past = schedule?.matches.filter((m) => m.status === 'completed') ?? [];

  return (
    <main className="px-4 py-6 max-w-lg mx-auto">
      <BackLink
        href={`/e/${eventSlug}/home`}
        label={t('publicApp.eventHome.backToHome')}
        className="mb-4"
      />
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
                  {t(ROLE_LABEL_KEYS[r])}
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
        <ThisIsMeCard
          eventSlug={eventSlug}
          personId={profile.id}
          hasAccount={profile.hasAccount}
          offerGuestAccess={viewerType === 'anonymous'}
          guestLoading={guestLoading}
          onGuestAccess={() => void handleGuestAccess()}
        />
      )}

      {/* Live now */}
      {live.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-danger mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-danger animate-pulse" />
            {t('publicApp.fighterProfile.liveNow')}
          </h2>
          {live.map((m) => (
            <Link key={m.id} href={boutHref(m)}>
              <div className="rounded-xl border-2 border-danger/40 bg-danger/10 p-4 mb-2">
                <p className="text-xs text-muted mb-1">{boutAndPiste(m)}</p>
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
              <Link key={m.id} href={boutHref(m)}>
                <div className="flex items-center justify-between bg-surface border border-border rounded-xl px-4 py-3 hover:border-muted transition-colors">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {t('publicApp.following.vsOpponent', { name: m.opponentName ?? '?' })}
                    </p>
                    <p className="text-xs text-muted">{boutAndPiste(m)}</p>
                  </div>
                  {m.scheduledAt && <p className="text-xs text-muted">{hallTime(m.scheduledAt)}</p>}
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
                  <p className="text-xs text-muted">{refereeRoleLabel(s.skillName, t)}</p>
                </div>
                {s.scheduledAt && <p className="text-xs text-muted">{hallTime(s.scheduledAt)}</p>}
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
                <Link key={m.id} href={boutHref(m)}>
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
