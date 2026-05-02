/**
 * Global fighter profile — T-607
 * Route: /fighters/[slug]
 *
 * Shows: bio, club, photo, current matches, history, HEMA Ratings.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

interface Props {
  params: Promise<{ slug: string }>;
}

interface Fighter {
  id: string;
  slug: string;
  displayName: string;
  givenName: string;
  familyName: string;
  clubName: string | null;
  clubSlug: string | null;
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

type RawFighter = Partial<Fighter> & {
  display_name?: string;
  given_name?: string;
  family_name?: string;
  club_name?: string | null;
  club_slug?: string | null;
  photo_url?: string | null;
  hema_ratings_id?: string | null;
  hemaRatings?: HemaRatingsProfile | null;
  hemaRatingsPending?: boolean;
  clubs?: { name?: string | null; slug?: string | null } | null;
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

async function fetchFighter(slug: string, apiUrl: string): Promise<Fighter | null> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/fighters/${slug}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as RawFighter;
    return {
      id: raw.id ?? '',
      slug: raw.slug ?? slug,
      displayName: raw.displayName ?? raw.display_name ?? '',
      givenName: raw.givenName ?? raw.given_name ?? '',
      familyName: raw.familyName ?? raw.family_name ?? '',
      clubName: raw.clubName ?? raw.club_name ?? raw.clubs?.name ?? null,
      clubSlug: raw.clubSlug ?? raw.club_slug ?? raw.clubs?.slug ?? null,
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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug };
}

export default async function FighterPage({ params }: Props) {
  const { slug } = await params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const fighter = await fetchFighter(slug, apiUrl);

  if (!fighter) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <p className="text-4xl mb-3">⚔️</p>
          <h1 className="text-xl font-bold text-white mb-2">Fighter not found</h1>
          <p className="text-gray-400 text-sm">No fighter with slug &ldquo;{slug}&rdquo;.</p>
        </div>
      </main>
    );
  }

  const live = fighter.recentMatches.filter((m) => m.status === 'running');
  const history = fighter.recentMatches.filter((m) => m.status === 'completed');

  return (
    <main className="px-4 py-6 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        {fighter.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fighter.photoUrl}
            alt={fighter.displayName}
            className="w-20 h-20 rounded-full object-cover border-2 border-gray-700"
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-red-900 border-2 border-red-700 flex items-center justify-center text-2xl font-black text-red-200">
            {fighter.givenName[0]}
            {fighter.familyName[0]}
          </div>
        )}
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white">{fighter.displayName}</h1>
          {fighter.clubName && (
            <Link
              href={`/clubs/${fighter.clubSlug ?? ''}`}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              {fighter.clubName}
            </Link>
          )}
          {fighter.hemaRatingsScore !== null && (
            <p className="text-xs text-amber-400 mt-1">
              HEMA Ratings: {fighter.hemaRatingsScore.toFixed(1)}
            </p>
          )}
        </div>
      </div>

      {/* Bio */}
      {fighter.bio && <p className="text-gray-300 text-sm leading-relaxed mb-6">{fighter.bio}</p>}

      {fighter.hemaRatingsId && (
        <section className="mb-6 rounded-xl border border-amber-700/50 bg-amber-950/20 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-amber-400">
                HEMA Ratings
              </h2>
              <a
                href={`https://hemaratings.com/fighters/details/${fighter.hemaRatingsId}/`}
                className="mt-1 inline-block text-sm text-amber-200 underline-offset-4 hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                Profile #{fighter.hemaRatingsId}
              </a>
            </div>
            {fighter.hemaRatings?.syncedAt && (
              <p className="text-right text-[11px] text-gray-500">
                Synced {new Date(fighter.hemaRatings.syncedAt).toLocaleDateString('en-GB')}
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
                          Last competed {new Date(rating.lastCompeted).toLocaleDateString('en-GB')}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-black tabular-nums text-amber-300">
                        {rating.weightedRating.toFixed(1)}
                      </p>
                      {rating.rank !== null && (
                        <p className="text-[11px] text-gray-500">Rank {rating.rank}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-400">Rating details pending next sync.</p>
          )}
        </section>
      )}

      {/* Live now */}
      {live.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-bold uppercase tracking-widest text-red-400 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            Live now
          </h2>
          {live.map((m) => (
            <Link key={m.id} href={m.eventSlug ? `/e/${m.eventSlug}/match/${m.id}` : '#'}>
              <div className="rounded-xl border-2 border-red-700 bg-red-950/30 p-4">
                <p className="text-xs text-gray-400 mb-1">{m.matchNumberLabel}</p>
                <p className="font-bold text-white">vs {m.opponentName ?? '?'}</p>
                <p className="text-2xl font-black tabular-nums mt-1">
                  <span className="text-red-400">{m.isRed ? m.redScore : m.blueScore}</span>
                  <span className="text-gray-600 mx-1.5">–</span>
                  <span className="text-blue-400">{m.isRed ? m.blueScore : m.redScore}</span>
                </p>
              </div>
            </Link>
          ))}
        </section>
      )}

      {/* Match history */}
      {history.length > 0 && (
        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest text-amber-400 mb-3">
            Recent results
          </h2>
          <div className="flex flex-col gap-2">
            {history.map((m) => {
              const myScore = m.isRed ? m.redScore : m.blueScore;
              const oppScore = m.isRed ? m.blueScore : m.redScore;
              const won = myScore > oppScore;
              return (
                <Link key={m.id} href={m.eventSlug ? `/e/${m.eventSlug}/match/${m.id}` : '#'}>
                  <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 hover:border-gray-600 transition-colors">
                    <div>
                      <p className="text-sm font-medium text-white">vs {m.opponentName ?? '?'}</p>
                      <p className="text-xs text-gray-500">{m.eventName ?? m.matchNumberLabel}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={[
                          'text-xs font-bold px-2 py-0.5 rounded-full',
                          won ? 'bg-green-900 text-green-300' : 'bg-red-900/50 text-red-400',
                        ].join(' ')}
                      >
                        {won ? 'W' : 'L'}
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

      {fighter.recentMatches.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-sm">No match history yet.</p>
        </div>
      )}
    </main>
  );
}
