/**
 * Club profile page — T-607
 * Route: /clubs/[slug]
 *
 * Shows: members, recent results.
 */

import type { Metadata } from 'next';
import { getServerApiUrl } from '@/lib/api-url';
import Link from 'next/link';
import { getServerT } from '@/i18n/server-locale';

interface Props {
  params: Promise<{ slug: string }>;
}

interface ClubMember {
  fighterId: string;
  fighterSlug: string;
  displayName: string;
  hemaRatingsScore: number | null;
}

interface ClubResult {
  matchId: string;
  eventSlug: string | null;
  fighterName: string;
  opponentName: string | null;
  won: boolean;
  redScore: number;
  blueScore: number;
  isRed: boolean;
  eventName: string | null;
}

interface Club {
  id: string;
  slug: string;
  name: string;
  country: string | null;
  logoUrl: string | null;
  members: ClubMember[];
  recentResults: ClubResult[];
}

async function fetchClub(slug: string, apiUrl: string): Promise<Club | null> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/clubs/${slug}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as Club;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug };
}

export default async function ClubPage({ params }: Props) {
  const t = await getServerT();
  const { slug } = await params;
  const apiUrl = getServerApiUrl();
  const club = await fetchClub(slug, apiUrl);

  if (!club) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <p className="text-4xl mb-3">🏛️</p>
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground mb-2">
            {t('publicApp.clubs.notFoundTitle')}
          </h1>
          <p className="text-muted text-sm">{t('publicApp.clubs.notFoundDescription', { slug })}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="px-4 py-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        {club.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={club.logoUrl}
            alt={club.name}
            className="w-16 h-16 rounded-xl object-contain border border-border bg-surface p-1"
          />
        ) : (
          <div className="w-16 h-16 rounded-xl bg-surface border border-border flex items-center justify-center text-2xl">
            🏛️
          </div>
        )}
        <div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
            {club.name}
          </h1>
          {club.country && <p className="text-sm text-muted">{club.country}</p>}
        </div>
      </div>

      {/* Members */}
      {club.members.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gold-text mb-3">
            {t('publicApp.clubs.members', { count: club.members.length })}
          </h2>
          <div className="flex flex-col gap-2">
            {club.members.map((m) => (
              <Link key={m.fighterId} href={`/fighters/${m.fighterSlug}`}>
                <div className="flex items-center justify-between bg-surface border border-border rounded-xl px-4 py-3 hover:border-muted transition-colors">
                  <p className="font-medium text-foreground">{m.displayName}</p>
                  {m.hemaRatingsScore !== null && (
                    <p className="text-xs text-gold-text">{m.hemaRatingsScore.toFixed(1)}</p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Recent results */}
      {club.recentResults.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gold-text mb-3">
            {t('publicApp.clubs.recentResults')}
          </h2>
          <div className="flex flex-col gap-2">
            {club.recentResults.map((r) => {
              const myScore = r.isRed ? r.redScore : r.blueScore;
              const oppScore = r.isRed ? r.blueScore : r.redScore;
              return (
                <Link
                  key={r.matchId}
                  href={r.eventSlug ? `/e/${r.eventSlug}/match/${r.matchId}` : '#'}
                >
                  <div className="flex items-center justify-between bg-surface border border-border rounded-xl px-4 py-3 hover:border-muted transition-colors">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {t('publicApp.clubs.versus', {
                          fighter: r.fighterName,
                          opponent: r.opponentName ?? '?',
                        })}
                      </p>
                      {r.eventName && <p className="text-xs text-muted">{r.eventName}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={[
                          'text-xs font-bold px-2 py-0.5 rounded-full',
                          r.won ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger',
                        ].join(' ')}
                      >
                        {r.won ? 'W' : 'L'}
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

      {club.members.length === 0 && club.recentResults.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted text-sm">{t('publicApp.clubs.noData')}</p>
        </div>
      )}
    </main>
  );
}
