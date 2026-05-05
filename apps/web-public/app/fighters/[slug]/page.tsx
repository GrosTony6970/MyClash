/**
 * Global fighter profile - T-607
 * Route: /fighters/[slug]
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { t } from '@myclash/i18n';

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
  hemaRatingsId: string | null;
  hemaRatingsScore: number | null;
  hemaRatings: HemaRatingsProfile | null;
  hemaRatingsPending: boolean;
  recentMatches: RecentMatch[];
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

interface TournamentPlacement {
  tournamentId: string;
  tournamentName: string;
  eventName: string;
  weapon: string | null;
  category: string | null;
  rank: number | null;
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
  tournamentPlacements: TournamentPlacement[];
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
  hema_ratings_id?: string | null;
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
      hemaRatingsId: raw.hemaRatingsId ?? raw.hema_ratings_id ?? null,
      hemaRatingsScore: raw.hemaRatingsScore ?? null,
      hemaRatings: raw.hemaRatings ?? null,
      hemaRatingsPending: raw.hemaRatingsPending ?? false,
      recentMatches: raw.recentMatches ?? [],
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

function formatDate(date: string | null): string {
  if (!date) return t('common.unknown');
  return new Date(date).toLocaleDateString('en-GB');
}

function statValue(value: number | null): string {
  if (value === null) return t('publicApp.fighterProfile.unknownRatio');
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatDuration(ms: number): string {
  if (ms <= 0) return t('common.none');
  const minutes = Math.round(ms / 60000);
  return t('publicApp.fighterProfile.minutes', { count: minutes });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug };
}

export default async function FighterPage({ params }: Props) {
  const { slug } = await params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const [fighter, career, refereeStats] = await Promise.all([
    fetchFighter(slug, apiUrl),
    fetchCareer(slug, apiUrl),
    fetchRefereeStats(slug, apiUrl),
  ]);

  if (!fighter) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-gray-700 bg-gray-900 text-xl font-black text-gray-300">
            ?
          </div>
          <h1 className="mb-2 text-xl font-bold text-white">
            {t('publicApp.fighterProfile.notFoundTitle')}
          </h1>
          <p className="text-sm text-gray-400">
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
  const overallStats = career?.stats.overall;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6 flex items-start gap-4">
        {fighter.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fighter.photoUrl}
            alt={fighter.displayName}
            className="h-20 w-20 rounded-full border-2 border-gray-700 object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-red-700 bg-red-900 text-2xl font-black text-red-200">
            {fighter.givenName[0]}
            {fighter.familyName[0]}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-white">{fighter.displayName}</h1>
          {fighter.clubName && (
            <Link
              href={`/clubs/${fighter.clubSlug ?? ''}`}
              className="text-sm text-gray-400 transition-colors hover:text-white"
            >
              {fighter.clubName}
            </Link>
          )}
          {fighter.hemaRatingsScore !== null && (
            <p className="mt-1 text-xs text-amber-400">
              {t('publicApp.fighterProfile.hemaRatings')}: {fighter.hemaRatingsScore.toFixed(1)}
            </p>
          )}
        </div>
      </div>

      {fighter.bio && <p className="mb-6 text-sm leading-relaxed text-gray-300">{fighter.bio}</p>}

      {(fighter.weapons.length > 0 || fighter.clubs.length > 0) && (
        <section className="mb-6 grid gap-3 sm:grid-cols-2">
          {fighter.weapons.length > 0 && (
            <ProfilePanel title={t('publicApp.fighterProfile.weapons')}>
              <div className="flex flex-wrap gap-2">
                {fighter.weapons.map((weapon) => (
                  <span
                    key={weapon.weapon_catalog?.id ?? weapon.weapon_catalog?.slug}
                    className="rounded-full border border-gray-700 bg-gray-900 px-2.5 py-1 text-xs text-gray-200"
                  >
                    {weapon.weapon_catalog?.name ?? t('common.unknown')}
                  </span>
                ))}
              </div>
            </ProfilePanel>
          )}
          {fighter.clubs.length > 0 && (
            <ProfilePanel title={t('publicApp.fighterProfile.clubs')}>
              <ClubLine label={t('publicApp.fighterProfile.mainClub')} clubs={mainClubs} />
              <ClubLine
                label={t('publicApp.fighterProfile.secondaryClubs')}
                clubs={secondaryClubs}
              />
              <ClubLine label={t('publicApp.fighterProfile.previousClubs')} clubs={previousClubs} />
            </ProfilePanel>
          )}
        </section>
      )}

      {overallStats && (
        <section className="mb-6 rounded-xl border border-gray-800 bg-gray-950 p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-amber-400">
            {t('publicApp.fighterProfile.stats')}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label={t('publicApp.fighterProfile.totalWins')} value={overallStats.wins} />
            <StatCard
              label={t('publicApp.fighterProfile.totalLosses')}
              value={overallStats.losses}
            />
            <StatCard
              label={t('publicApp.fighterProfile.winLossRatio')}
              value={statValue(overallStats.winLossRatio)}
            />
            <StatCard
              label={t('publicApp.fighterProfile.doubleHitPercentage')}
              value={`${overallStats.doubleHitPercentage.toFixed(2)}%`}
            />
          </div>
        </section>
      )}

      {fighter.hemaRatingsId && (
        <section className="mb-6 rounded-xl border border-amber-700/50 bg-amber-950/20 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-amber-400">
                {t('publicApp.fighterProfile.hemaRatings')}
              </h2>
              <a
                href={`https://hemaratings.com/fighters/details/${fighter.hemaRatingsId}/`}
                className="mt-1 inline-block text-sm text-amber-200 underline-offset-4 hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                #{fighter.hemaRatingsId}
              </a>
            </div>
            {fighter.hemaRatings?.syncedAt && (
              <p className="text-right text-[11px] text-gray-500">
                {t('publicApp.fighterProfile.synced', {
                  date: formatDate(fighter.hemaRatings.syncedAt),
                })}
              </p>
            )}
          </div>

          {fighter.hemaRatings?.ratings.length ? (
            <div className="mt-4 divide-y divide-amber-900/50">
              {fighter.hemaRatings.ratings.map((rating) => (
                <div
                  key={`${rating.weapon}-${rating.category}`}
                  className="py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{rating.weapon}</p>
                      <p className="text-xs text-gray-400">{rating.category}</p>
                      {rating.lastCompeted && (
                        <p className="mt-1 text-[11px] text-gray-500">
                          {t('publicApp.fighterProfile.lastCompeted', {
                            date: formatDate(rating.lastCompeted),
                          })}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-black tabular-nums text-amber-300">
                        {rating.weightedRating.toFixed(1)}
                      </p>
                      {rating.rank !== null && (
                        <p className="text-[11px] text-gray-500">
                          {t('publicApp.fighterProfile.rank', { rank: rating.rank })}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-400">
              {t('publicApp.fighterProfile.ratingPending')}
            </p>
          )}
        </section>
      )}

      {refereeStats && refereeStats.totalMatches > 0 && (
        <section className="mb-6 rounded-xl border border-gray-800 bg-gray-950 p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-amber-400">
            {t('publicApp.fighterProfile.refereeing')}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label={t('publicApp.fighterProfile.refereeMatches')}
              value={refereeStats.totalMatches}
            />
            <StatCard
              label={t('publicApp.fighterProfile.averageRefereeTime')}
              value={formatDuration(refereeStats.averageRefereeTimeMs)}
            />
            <StatCard
              label={t('publicApp.fighterProfile.yellowCards')}
              value={refereeStats.cards.yellow}
            />
            <StatCard
              label={t('publicApp.fighterProfile.redBlackCards')}
              value={`${refereeStats.cards.red}/${refereeStats.cards.black}`}
            />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <ProfilePanel title={t('publicApp.fighterProfile.refereeRoles')}>
              <RefereeLine
                label={t('publicApp.fighterProfile.arbitreDeclarant')}
                value={refereeStats.roles.arbitre_declarant}
              />
              <RefereeLine
                label={t('publicApp.fighterProfile.arbitreAssesseur')}
                value={refereeStats.roles.arbitre_assesseur}
              />
              <RefereeLine
                label={t('publicApp.fighterProfile.arbitreTable')}
                value={refereeStats.roles.arbitre_table}
              />
            </ProfilePanel>
            {refereeStats.bestBuddies.length > 0 && (
              <ProfilePanel title={t('publicApp.fighterProfile.bestRefereeBuddies')}>
                <ul className="space-y-2 text-sm text-gray-300">
                  {refereeStats.bestBuddies.slice(0, 3).map((buddy) => (
                    <li
                      key={buddy.userId}
                      className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2"
                    >
                      <span>{buddy.displayName ?? t('common.unknown')}</span>
                      <span className="text-xs text-gray-500">
                        {t('publicApp.fighterProfile.matchesTogether', {
                          count: buddy.matchesTogether,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </ProfilePanel>
            )}
          </div>
        </section>
      )}

      {career && (
        <section className="mb-6 grid gap-3 sm:grid-cols-2">
          <CareerList title={t('publicApp.fighterProfile.upcoming')}>
            {career.upcoming.slice(0, 5).map((registration) => (
              <li key={registration.id}>
                <Link className="font-medium text-white" href={`/e/${registration.eventSlug}`}>
                  {registration.eventName}
                </Link>
                <p className="text-xs text-gray-500">
                  {registration.tournamentName} · {formatDate(registration.eventStartDate)}
                </p>
              </li>
            ))}
          </CareerList>
          <CareerList title={t('publicApp.fighterProfile.eventParticipation')}>
            {career.eventParticipation.slice(0, 5).map((event) => (
              <li key={event.eventId}>
                <Link className="font-medium text-white" href={`/e/${event.eventSlug}`}>
                  {event.eventName}
                </Link>
                <p className="text-xs text-gray-500">{formatDate(event.startDate)}</p>
              </li>
            ))}
          </CareerList>
          <CareerList title={t('publicApp.fighterProfile.tournamentPlacements')}>
            {career.tournamentPlacements.slice(0, 5).map((placement) => (
              <li key={placement.tournamentId}>
                <span className="font-medium text-white">{placement.tournamentName}</span>
                <p className="text-xs text-gray-500">
                  {placement.eventName} · {placement.weapon ?? t('common.unknown')} ·{' '}
                  {placement.rank ?? t('publicApp.fighterProfile.dnp')}
                </p>
              </li>
            ))}
          </CareerList>
          <CareerList title={t('publicApp.fighterProfile.leagueRankings')}>
            {career.leagueRankings.slice(0, 5).map((ranking) => (
              <li key={`${ranking.leagueName}-${ranking.group}`}>
                <span className="font-medium text-white">{ranking.leagueName}</span>
                <p className="text-xs text-gray-500">
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
          <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-red-400">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            {t('publicApp.fighterProfile.liveNow')}
          </h2>
          {live.map((match) => (
            <Link
              key={match.id}
              href={match.eventSlug ? `/e/${match.eventSlug}/match/${match.id}` : '#'}
            >
              <div className="rounded-xl border-2 border-red-700 bg-red-950/30 p-4">
                <p className="mb-1 text-xs text-gray-400">{match.matchNumberLabel}</p>
                <p className="font-bold text-white">{match.opponentName ?? t('common.unknown')}</p>
                <p className="mt-1 text-2xl font-black tabular-nums">
                  <span className="text-red-400">
                    {match.isRed ? match.redScore : match.blueScore}
                  </span>
                  <span className="mx-1.5 text-gray-600">-</span>
                  <span className="text-blue-400">
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
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-amber-400">
            {t('publicApp.fighterProfile.recentResults')}
          </h2>
          <div className="flex flex-col gap-2">
            {history.map((match) => {
              const myScore = match.isRed ? match.redScore : match.blueScore;
              const oppScore = match.isRed ? match.blueScore : match.redScore;
              const won = myScore > oppScore;
              return (
                <Link
                  key={match.id}
                  href={match.eventSlug ? `/e/${match.eventSlug}/match/${match.id}` : '#'}
                >
                  <div className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 px-4 py-3 transition-colors hover:border-gray-600">
                    <div>
                      <p className="text-sm font-medium text-white">
                        {match.opponentName ?? t('common.unknown')}
                      </p>
                      <p className="text-xs text-gray-500">
                        {match.eventName ?? match.matchNumberLabel}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={[
                          'rounded-full px-2 py-0.5 text-xs font-bold',
                          won ? 'bg-green-900 text-green-300' : 'bg-red-900/50 text-red-400',
                        ].join(' ')}
                      >
                        {won ? 'W' : 'L'}
                      </span>
                      <p className="font-mono text-sm font-bold tabular-nums text-white">
                        {myScore}-{oppScore}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="py-12 text-center">
          <p className="text-sm text-gray-500">{t('publicApp.fighterProfile.noMatchHistory')}</p>
        </div>
      )}
    </main>
  );
}

function ProfilePanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-amber-400">{title}</h2>
      {children}
    </div>
  );
}

function ClubLine({ label, clubs }: { label: string; clubs: FighterClubLink[] }) {
  if (clubs.length === 0) return null;
  return (
    <p className="mb-2 text-sm text-gray-300 last:mb-0">
      <span className="text-gray-500">{label}: </span>
      {clubs.map((club) => club.clubs?.name ?? t('common.unknown')).join(', ')}
    </p>
  );
}

function RefereeLine({ label, value }: { label: string; value: number }) {
  return (
    <p className="mb-2 flex items-center justify-between gap-3 text-sm text-gray-300 last:mb-0">
      <span className="text-gray-500">{label}</span>
      <span className="font-semibold tabular-nums text-white">{value}</span>
    </p>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-3">
      <p className="text-[11px] uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-black tabular-nums text-white">{value}</p>
    </div>
  );
}

function CareerList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-amber-400">{title}</h2>
      <ul className="space-y-3 text-sm text-gray-300">{children}</ul>
    </div>
  );
}
