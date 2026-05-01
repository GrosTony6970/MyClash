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
  recentMatches: RecentMatch[];
}

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
    return (await res.json()) as Fighter;
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
