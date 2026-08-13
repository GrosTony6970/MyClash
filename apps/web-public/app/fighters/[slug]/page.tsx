/**
 * Global fighter profile - T-607
 * Route: /fighters/[slug]
 */

import type { Metadata } from 'next';
import { getServerApiUrl, getPublicApiUrl } from '@/lib/api-url';
import Link from 'next/link';
import { createTranslator, getMessages, type Locale } from '@myclash/i18n';
import { localeToBcp47 } from '@myclash/time';
import { resolveServerLocale } from '@myclash/next-i18n/server';
import { MatchHistoryTrigger } from './_components/MatchHistoryTrigger';
import { RatingHistorySection } from './_components/RatingHistorySection';
import { FighterStatsPanel } from '@/components/fighter/FighterStatsPanel';
import { ShareProfile } from '@/components/fighter/ShareProfile';
import type { FighterMedal, FighterPlacement } from '@/lib/weapon-stats';

interface Props {
  params: Promise<{ slug: string }>;
}

interface FighterClubLink {
  role?: string;
  clubs?: {
    id?: string;
    slug?: string | null;
    name?: string | null;
    city?: string | null;
    country_code?: string | null;
  } | null;
}

interface FighterWeaponLink {
  favorite?: boolean;
  level?: string | null;
  style?: string | null;
  weapon_catalog?: {
    id?: string;
    slug?: string | null;
    name?: string | null;
  } | null;
}

interface Fighter {
  id: string;
  slug: string;
  displayName: string;
  givenName: string;
  familyName: string;
  clubName: string | null;
  clubSlug: string | null;
  clubs: FighterClubLink[];
  weapons: FighterWeaponLink[];
  photoUrl: string | null;
  bio: string | null;
  alias: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  youtubeUrl: string | null;
  practicingSinceYear: number | null;
  hemaRatingsId: string | null;
  hemaRatingsScore: number | null;
  hemaRatings: HemaRatingsProfile | null;
  hemaRatingsPending: boolean;
  medals: FighterMedal[];
  recentMatches: RecentMatch[];
  /**
   * Set when the linked account was erased. The results below are unaffected —
   * they are a public record — but the personal profile fields are gone, so the
   * page says so rather than looking like an unfinished profile.
   */
  accountDeletedAt: string | null;
}

interface HemaRatingsProfile {
  id: string;
  name: string;
  club: string;
  nationality?: string | null;
  detailsUrl: string;
  syncedAt: string;
  ratings: HemaRatingsRating[];
}

interface HemaRatingsRating {
  weapon: string;
  category: string;
  rank: number | null;
  weightedRating: number;
  lastCompeted: string | null;
}

interface CareerStats {
  matches: number;
  wins: number;
  losses: number;
  winLossRatio: number | null;
  doubleHits: number;
  exchanges: number;
  doubleHitPercentage: number;
}

interface CareerRegistration {
  id: string;
  tournamentName: string;
  tournamentSlug: string;
  weapon: string | null;
  category: string | null;
  eventName: string;
  eventSlug: string;
  eventStartDate: string | null;
}

interface CareerEvent {
  eventId: string;
  eventName: string;
  eventSlug: string;
  startDate: string | null;
  endDate: string | null;
}

interface LeagueRanking {
  leagueName: string;
  rank: number;
  totalPoints: number;
  group: string;
}

interface FighterCareer {
  eventParticipation: CareerEvent[];
  upcoming: CareerRegistration[];
  tournamentPlacements: FighterPlacement[];
  leagueRankings: LeagueRanking[];
  stats: {
    overall: CareerStats;
    byWeapon: Array<CareerStats & { weapon: string; category: string | null }>;
    byYear: Array<CareerStats & { year: string }>;
  };
}

interface RefereeStats {
  totalMatches: number;
  averageRefereeTimeMs: number;
  eventsWorked: number;
  roles: {
    arbitre_declarant: number;
    arbitre_assesseur: number;
    arbitre_table: number;
  };
  cards: {
    yellow: number;
    red: number;
    black: number;
  };
  bestBuddies: Array<{
    userId: string;
    displayName: string | null;
    matchesTogether: number;
  }>;
}

type RawFighter = Omit<Partial<Fighter>, 'clubs' | 'weapons'> & {
  display_name?: string;
  given_name?: string;
  family_name?: string;
  club_name?: string | null;
  club_slug?: string | null;
  photo_url?: string | null;
  website_url?: string | null;
  instagram_url?: string | null;
  youtube_url?: string | null;
  practicing_since_year?: number | null;
  hema_ratings_id?: string | null;
  account_deleted_at?: string | null;
  hemaRatings?: HemaRatingsProfile | null;
  hemaRatingsPending?: boolean;
  clubs?: FighterClubLink[] | { name?: string | null; slug?: string | null } | null;
  weapons?: FighterWeaponLink[];
};

interface RecentMatch {
  id: string;
  matchNumberLabel: string;
  status: string;
  opponentName: string | null;
  redScore: number;
  blueScore: number;
  isRed: boolean;
  outcome: 'win' | 'loss' | 'draw';
  eventName: string | null;
  eventSlug: string | null;
  scheduledAt: string | null;
}

function toClubLinks(
  clubs: RawFighter['clubs'],
  fallbackName: string | null,
  fallbackSlug: string | null,
): FighterClubLink[] {
  if (Array.isArray(clubs)) return clubs;
  if (clubs?.name || fallbackName) {
    return [
      {
        role: 'main',
        clubs: {
          name: clubs?.name ?? fallbackName,
          slug: clubs?.slug ?? fallbackSlug,
        },
      },
    ];
  }
  return [];
}

async function fetchFighter(slug: string, apiUrl: string): Promise<Fighter | null> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/fighters/${slug}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as RawFighter;
    const clubName = raw.clubName ?? raw.club_name ?? null;
    const clubSlug = raw.clubSlug ?? raw.club_slug ?? null;
    return {
      id: raw.id ?? '',
      slug: raw.slug ?? slug,
      displayName: raw.displayName ?? raw.display_name ?? '',
      givenName: raw.givenName ?? raw.given_name ?? '',
      familyName: raw.familyName ?? raw.family_name ?? '',
      clubName,
      clubSlug,
      clubs: toClubLinks(raw.clubs, clubName, clubSlug),
      weapons: raw.weapons ?? [],
      photoUrl: raw.photoUrl ?? raw.photo_url ?? null,
      bio: raw.bio ?? null,
      alias: raw.alias ?? null,
      websiteUrl: raw.websiteUrl ?? raw.website_url ?? null,
      instagramUrl: raw.instagramUrl ?? raw.instagram_url ?? null,
      youtubeUrl: raw.youtubeUrl ?? raw.youtube_url ?? null,
      practicingSinceYear: raw.practicingSinceYear ?? raw.practicing_since_year ?? null,
      hemaRatingsId: raw.hemaRatingsId ?? raw.hema_ratings_id ?? null,
      hemaRatingsScore: raw.hemaRatingsScore ?? null,
      hemaRatings: raw.hemaRatings ?? null,
      hemaRatingsPending: raw.hemaRatingsPending ?? false,
      medals: raw.medals ?? [],
      recentMatches: raw.recentMatches ?? [],
      accountDeletedAt: raw.accountDeletedAt ?? raw.account_deleted_at ?? null,
    };
  } catch {
    return null;
  }
}

async function fetchCareer(slug: string, apiUrl: string): Promise<FighterCareer | null> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/fighters/${slug}/career`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as FighterCareer;
  } catch {
    return null;
  }
}

/** Published AI insight for this fighter (null unless they published one). */
async function fetchPublishedInsight(
  globalPersonId: string,
  apiUrl: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/public/generated-content/fighter_insight/${globalPersonId}?locale=en`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: string } | null;
    return data?.content ?? null;
  } catch {
    return null;
  }
}

async function fetchRefereeStats(slug: string, apiUrl: string): Promise<RefereeStats | null> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/fighters/${slug}/referee-stats`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as RefereeStats;
  } catch {
    return null;
  }
}

function formatDate(date: string | null, locale: Locale): string {
  if (!date) return createTranslator(getMessages(locale))('common.unknown');
  return new Date(date).toLocaleDateString(localeToBcp47(locale));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug };
}

export default async function FighterPage({ params }: Props) {
  const { slug } = await params;
  const apiUrl = getServerApiUrl();
  const locale = await resolveServerLocale();
  const t = createTranslator(getMessages(locale));
  const [fighter, career, refereeStats] = await Promise.all([
    fetchFighter(slug, apiUrl),
    fetchCareer(slug, apiUrl),
    fetchRefereeStats(slug, apiUrl),
  ]);

  if (!fighter) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-border bg-surface text-xl font-black text-muted">
            ?
          </div>
          <h1 className="mb-2 font-display font-bold text-2xl sm:text-3xl text-foreground">
            {t('publicApp.fighterProfile.notFoundTitle')}
          </h1>
          <p className="text-sm text-muted">
            {t('publicApp.fighterProfile.notFoundDescription', { slug })}
          </p>
        </div>
      </main>
    );
  }

  const live = fighter.recentMatches.filter((match) => match.status === 'running');
  const history = fighter.recentMatches.filter((match) => match.status === 'completed');
  const mainClubs = fighter.clubs.filter((club) => club.role === 'main');
  const secondaryClubs = fighter.clubs.filter((club) => club.role === 'secondary');
  const previousClubs = fighter.clubs.filter((club) => club.role === 'previous');
  const insight = fighter.id ? await fetchPublishedInsight(fighter.id, apiUrl) : null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex items-start gap-4">
        {fighter.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fighter.photoUrl}
            alt={fighter.displayName}
            className="h-20 w-20 rounded-full border-2 border-border object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-border bg-accent text-2xl font-black text-accent-foreground">
            {fighter.givenName[0]}
            {fighter.familyName[0]}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
            {fighter.displayName}
          </h1>
          {fighter.alias && <p className="text-sm italic text-muted">{fighter.alias}</p>}
          {fighter.clubName &&
            (fighter.clubSlug ? (
              <Link
                href={`/clubs/${fighter.clubSlug}`}
                className="block text-sm text-muted transition-colors hover:text-foreground"
              >
                {fighter.clubName}
              </Link>
            ) : (
              // Free-text club label without a linked club row — no /clubs/
              // page exists for it, so render plain text instead of a 404 link.
              <p className="text-sm text-muted">{fighter.clubName}</p>
            ))}
          {fighter.practicingSinceYear && (
            <p className="mt-1 text-xs text-muted">
              {t('publicApp.fighterProfile.practicingSinceLabel', {
                year: fighter.practicingSinceYear,
              })}
            </p>
          )}
          {fighter.hemaRatingsScore !== null && (
            <p className="mt-1 text-xs text-accent">
              {t('publicApp.fighterProfile.hemaRatings')}: {fighter.hemaRatingsScore.toFixed(1)}
            </p>
          )}
          {(fighter.websiteUrl ||
            fighter.instagramUrl ||
            fighter.youtubeUrl ||
            fighter.hemaRatings?.detailsUrl) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {fighter.websiteUrl && (
                <a
                  href={fighter.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted transition-colors hover:text-foreground"
                >
                  {t('publicApp.fighterProfile.website')}
                </a>
              )}
              {fighter.instagramUrl && (
                <a
                  href={fighter.instagramUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted transition-colors hover:text-foreground"
                >
                  {t('publicApp.fighterProfile.instagram')}
                </a>
              )}
              {fighter.youtubeUrl && (
                <a
                  href={fighter.youtubeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted transition-colors hover:text-foreground"
                >
                  {t('publicApp.fighterProfile.youtube')}
                </a>
              )}
              {fighter.hemaRatings?.detailsUrl && (
                <a
                  href={fighter.hemaRatings.detailsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted transition-colors hover:text-foreground"
                >
                  {t('publicApp.fighterProfile.hemaRatings')}
                </a>
              )}
            </div>
          )}
        </div>
        {fighter.slug && (
          <div className="hidden shrink-0 sm:block">
            <ShareProfile slug={fighter.slug} />
          </div>
        )}
      </div>

      {fighter.bio && (
        <p className="mb-6 text-sm leading-relaxed text-foreground-secondary">{fighter.bio}</p>
      )}

      {fighter.accountDeletedAt && (
        <p className="mb-6 rounded-xl border border-border bg-surface p-4 text-sm text-muted">
          {t('publicApp.fighterProfile.accountDeletedNote')}
        </p>
      )}

      {insight && (
        <section className="mb-6 rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent">
            {t('publicApp.fighterProfile.insightTitle')}
          </h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground-secondary">
            {insight}
          </p>
        </section>
      )}

      {fighter.clubs.length > 0 && (
        <section className="mb-6">
          <ProfilePanel title={t('publicApp.fighterProfile.clubs')}>
            <ClubLine
              label={t('publicApp.fighterProfile.mainClub')}
              clubs={mainClubs}
              locale={locale}
            />
            <ClubLine
              label={t('publicApp.fighterProfile.secondaryClubs')}
              clubs={secondaryClubs}
              locale={locale}
            />
            <ClubLine
              label={t('publicApp.fighterProfile.previousClubs')}
              clubs={previousClubs}
              locale={locale}
            />
          </ProfilePanel>
        </section>
      )}

      <section className="mb-6">
        <FighterStatsPanel
          fighter={{
            weapons: fighter.weapons,
            hemaRatingsId: fighter.hemaRatingsId,
            hemaRatings: fighter.hemaRatings,
            medals: fighter.medals,
          }}
          career={
            career
              ? { stats: career.stats, tournamentPlacements: career.tournamentPlacements }
              : null
          }
          refereeStats={
            refereeStats
              ? {
                  totalMatches: refereeStats.totalMatches,
                  averageRefereeTimeMs: refereeStats.averageRefereeTimeMs,
                  eventsWorked: refereeStats.eventsWorked,
                  cards: refereeStats.cards,
                }
              : null
          }
        />
      </section>

      {fighter.hemaRatingsId && (
        <RatingHistorySection slug={fighter.slug} apiUrl={getPublicApiUrl()} />
      )}

      {career && (
        <section className="mb-6 grid gap-3 sm:grid-cols-2">
          <CareerList title={t('publicApp.fighterProfile.upcoming')}>
            {career.upcoming.slice(0, 5).map((registration) => (
              <li key={registration.id}>
                <Link
                  className="font-medium text-foreground hover:text-accent"
                  href={`/e/${registration.eventSlug}`}
                >
                  {registration.eventName}
                </Link>
                <p className="text-xs text-muted">
                  {registration.tournamentName} · {formatDate(registration.eventStartDate, locale)}
                </p>
              </li>
            ))}
          </CareerList>
          <CareerList title={t('publicApp.fighterProfile.eventParticipation')}>
            {career.eventParticipation.slice(0, 5).map((event) => (
              <li key={event.eventId}>
                <Link
                  className="font-medium text-foreground hover:text-accent"
                  href={`/e/${event.eventSlug}`}
                >
                  {event.eventName}
                </Link>
                <p className="text-xs text-muted">{formatDate(event.startDate, locale)}</p>
              </li>
            ))}
          </CareerList>
          <CareerList title={t('publicApp.fighterProfile.tournamentPlacements')}>
            {career.tournamentPlacements.slice(0, 5).map((placement) => (
              <li key={placement.tournamentId}>
                <span className="font-medium text-foreground">{placement.tournamentName}</span>
                <p className="text-xs text-muted">
                  {placement.eventName} · {placement.weapon ?? t('common.unknown')} ·{' '}
                  {placement.place ?? t('publicApp.fighterProfile.dnp')}
                </p>
              </li>
            ))}
          </CareerList>
          <CareerList title={t('publicApp.fighterProfile.leagueRankings')}>
            {career.leagueRankings.slice(0, 5).map((ranking) => (
              <li key={`${ranking.leagueName}-${ranking.group}`}>
                <span className="font-medium text-foreground">{ranking.leagueName}</span>
                <p className="text-xs text-muted">
                  {ranking.group} · {t('publicApp.fighterProfile.rank', { rank: ranking.rank })} ·{' '}
                  {ranking.totalPoints}
                </p>
              </li>
            ))}
          </CareerList>
        </section>
      )}

      {live.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-danger">
            <span className="h-2 w-2 rounded-full bg-danger" />
            {t('publicApp.fighterProfile.liveNow')}
          </h2>
          {live.map((match) => (
            <Link
              key={match.id}
              href={match.eventSlug ? `/e/${match.eventSlug}/match/${match.id}` : '#'}
            >
              <div className="rounded-xl border-2 border-danger bg-danger/10 p-4">
                <p className="mb-1 text-xs text-foreground-secondary">{match.matchNumberLabel}</p>
                <p className="font-bold text-foreground">
                  {match.opponentName ?? t('common.unknown')}
                </p>
                <p className="mt-1 text-2xl font-black tabular-nums">
                  <span className="text-danger">
                    {match.isRed ? match.redScore : match.blueScore}
                  </span>
                  <span className="mx-1.5 text-muted">-</span>
                  <span className="text-info">
                    {match.isRed ? match.blueScore : match.redScore}
                  </span>
                </p>
              </div>
            </Link>
          ))}
        </section>
      )}

      {history.length > 0 ? (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-accent">
            {t('publicApp.fighterProfile.recentResults')}
          </h2>
          <div className="flex flex-col gap-2">
            {history.map((match) => {
              const myScore = match.isRed ? match.redScore : match.blueScore;
              const oppScore = match.isRed ? match.blueScore : match.redScore;
              const chipClass =
                match.outcome === 'win'
                  ? 'bg-success/15 text-success'
                  : match.outcome === 'draw'
                    ? 'bg-warning/15 text-warning'
                    : 'bg-danger/15 text-danger';
              return (
                <Link
                  key={match.id}
                  href={match.eventSlug ? `/e/${match.eventSlug}/match/${match.id}` : '#'}
                >
                  <div className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:border-muted">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {match.opponentName ?? t('common.unknown')}
                      </p>
                      <p className="text-xs text-muted">
                        {match.eventName ?? match.matchNumberLabel}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={['rounded-full px-2 py-0.5 text-xs font-bold', chipClass].join(
                          ' ',
                        )}
                      >
                        {match.outcome === 'win' ? 'W' : match.outcome === 'draw' ? 'D' : 'L'}
                      </span>
                      <p className="font-mono text-sm font-bold tabular-nums text-foreground">
                        {myScore}-{oppScore}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
          <MatchHistoryTrigger slug={fighter.slug} apiUrl={getPublicApiUrl()} />
        </section>
      ) : (
        <div className="py-12 text-center">
          <p className="text-sm text-muted">{t('publicApp.fighterProfile.noMatchHistory')}</p>
          <MatchHistoryTrigger slug={fighter.slug} apiUrl={getPublicApiUrl()} />
        </div>
      )}
    </main>
  );
}

function ProfilePanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-accent">{title}</h2>
      {children}
    </div>
  );
}

function ClubLine({
  label,
  clubs,
  locale,
}: {
  label: string;
  clubs: FighterClubLink[];
  locale: Locale;
}) {
  if (clubs.length === 0) return null;
  const t = createTranslator(getMessages(locale));
  return (
    <p className="mb-2 text-sm text-foreground-secondary last:mb-0">
      <span className="text-muted">{label}: </span>
      {clubs.map((club) => club.clubs?.name ?? t('common.unknown')).join(', ')}
    </p>
  );
}

function CareerList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-accent">{title}</h2>
      <ul className="space-y-3 text-sm text-foreground-secondary">{children}</ul>
    </div>
  );
}
