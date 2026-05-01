/**
 * Tournament stats page — T-1003
 * Route: /e/[eventSlug]/t/[tournamentSlug]/stats
 *
 * Reproduces the lyonamhe.fr/resultat_fal2026.html layout:
 *   - Overview hero numbers
 *   - Per-fighter detailed table (Dbl / ✓1 / ✓1-1 / ✓2 / ✓2-1 / ✗1 / ✗1-1 / ✗2 / ✗2-1 / Total / Ratio)
 *   - Distribution chart (exchange types)
 *   - Double-rate evolution (top doubles fighters)
 *   - Top 5 blow-ratio fighters
 *
 * Note: hit_ratio is BLOW-based (mode-independent) per the data model.
 * point_ratio is also available for scoring-based ranking.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

interface Props {
  params: Promise<{ eventSlug: string; tournamentSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tournamentSlug } = await params;
  return { title: `Stats — ${tournamentSlug}` };
}

// ── API types ─────────────────────────────────────────────────────────────────

interface FighterStats {
  registrationId: string;
  givenName: string;
  familyName: string;
  clubName: string | null;
  doubles: number;
  hitsGiven1: number;
  afterblowGiven1: number;
  hitsGiven2: number;
  afterblowGiven2: number;
  hitsReceived1: number;
  afterblowReceived1: number;
  hitsReceived2: number;
  afterblowReceived2: number;
  blowsGiven: number;
  blowsReceived: number;
  afterblowsReceivedTotal: number;
  pointsGiven: number;
  pointsReceived: number;
  totalExchanges: number;
  hitRatio: number | null;
  pointRatio: number | null;
}

interface Overview {
  tournamentId: string;
  participantCount: number;
  matchCount: number;
  exchangeCount: number;
  doublesCount: number;
  doublesPercent: number;
  clubCount: number;
  topFighters: Array<{
    name: string;
    club: string | null;
    hitRatio: number | null;
    blowsGiven: number;
    blowsReceived: number;
  }>;
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchStats(
  tournamentId: string,
  apiUrl: string,
): Promise<{ overview: Overview | null; fighters: FighterStats[] }> {
  try {
    const [overviewRes, fightersRes] = await Promise.all([
      fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/stats/overview`, {
        cache: 'no-store',
      }),
      fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/stats/fighters`, {
        cache: 'no-store',
      }),
    ]);

    const overview = overviewRes.ok ? ((await overviewRes.json()) as Overview) : null;
    const fighters = fightersRes.ok ? ((await fightersRes.json()) as FighterStats[]) : [];

    return { overview, fighters };
  } catch {
    return { overview: null, fighters: [] };
  }
}

async function fetchTournamentId(
  eventSlug: string,
  tournamentSlug: string,
  apiUrl: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/events/${eventSlug}/tournaments/${tournamentSlug}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const t = (await res.json()) as { id: string };
    return t.id;
  } catch {
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return String(n);
}

function fmtRatio(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return n.toFixed(3);
}

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function StatsPage({ params }: Props) {
  const { eventSlug, tournamentSlug } = await params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const tournamentId = await fetchTournamentId(eventSlug, tournamentSlug, apiUrl);
  if (!tournamentId) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <p className="text-4xl mb-3">📊</p>
          <h1 className="text-xl font-bold text-white mb-2">Stats not available</h1>
          <Link
            href={`/e/${eventSlug}/t/${tournamentSlug}`}
            className="text-sm text-gray-400 hover:underline"
          >
            ← Back to tournament
          </Link>
        </div>
      </main>
    );
  }

  const { overview, fighters } = await fetchStats(tournamentId, apiUrl);

  // Sort fighters by hit_ratio desc (blow-based, mode-independent)
  const sorted = [...fighters].sort((a, b) => (b.hitRatio ?? -1) - (a.hitRatio ?? -1));

  // Exchange type distribution
  const totalClean = fighters.reduce((s, f) => s + f.hitsGiven1 + f.hitsGiven2, 0) / 2; // each exchange counted twice (attacker + defender)
  const totalAfterblows =
    fighters.reduce((s, f) => s + f.afterblowGiven1 + f.afterblowGiven2, 0) / 2;
  const totalDoubles = overview?.doublesCount ?? 0;
  const totalEx = overview?.exchangeCount ?? 1;

  return (
    <main className="px-4 py-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            href={`/e/${eventSlug}/t/${tournamentSlug}`}
            className="text-sm text-gray-400 hover:text-gray-200 mb-1 inline-block"
          >
            ← Tournament
          </Link>
          <h1
            className="text-2xl font-bold"
            style={{
              fontFamily: 'var(--font-display)',
              color: 'var(--event-primary, #c0392b)',
            }}
          >
            Statistics
          </h1>
        </div>
      </div>

      {/* ── Hero numbers ── */}
      {overview && (
        <div className="grid grid-cols-2 gap-3 mb-8 sm:grid-cols-4">
          {[
            { label: 'Participants', value: overview.participantCount },
            { label: 'Matches', value: overview.matchCount },
            { label: 'Exchanges', value: overview.exchangeCount },
            {
              label: 'Doubles',
              value: `${overview.doublesCount} (${overview.doublesPercent}%)`,
            },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center"
            >
              <p className="text-2xl font-black text-white">{value}</p>
              <p className="text-xs text-gray-500 mt-0.5 uppercase tracking-wide">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Exchange distribution ── */}
      {overview && overview.exchangeCount > 0 && (
        <section className="mb-8">
          <h2
            className="text-xs font-bold uppercase tracking-widest mb-3"
            style={{ color: 'var(--event-accent, #f59e0b)' }}
          >
            Exchange distribution
          </h2>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex gap-1 h-8 rounded-lg overflow-hidden mb-2">
              {[
                {
                  n: totalClean,
                  color: 'bg-green-700',
                  label: 'Clean',
                },
                {
                  n: totalAfterblows,
                  color: 'bg-orange-700',
                  label: 'Afterblow',
                },
                {
                  n: totalDoubles,
                  color: 'bg-red-800',
                  label: 'Double',
                },
              ].map(({ n, color }) => (
                <div
                  key={color}
                  className={`${color} transition-all`}
                  style={{ width: `${(n / totalEx) * 100}%` }}
                />
              ))}
            </div>
            <div className="flex gap-4 text-xs text-gray-400">
              <span>
                <span className="inline-block w-2 h-2 rounded-full bg-green-700 mr-1" />
                Clean {pct(totalClean, totalEx)}
              </span>
              <span>
                <span className="inline-block w-2 h-2 rounded-full bg-orange-700 mr-1" />
                Afterblow {pct(totalAfterblows, totalEx)}
              </span>
              <span>
                <span className="inline-block w-2 h-2 rounded-full bg-red-800 mr-1" />
                Double {pct(totalDoubles, totalEx)}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* ── Top 5 by blow ratio ── */}
      {overview && overview.topFighters.length > 0 && (
        <section className="mb-8">
          <h2
            className="text-xs font-bold uppercase tracking-widest mb-3"
            style={{ color: 'var(--event-accent, #f59e0b)' }}
          >
            Top fighters — blow ratio (mode-independent)
          </h2>
          <div className="flex flex-col gap-2">
            {overview.topFighters.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3"
              >
                <span className="text-gray-600 font-bold w-5 text-right text-sm">{i + 1}</span>
                <div className="flex-1">
                  <p className="font-semibold text-white text-sm">{f.name}</p>
                  {f.club && <p className="text-xs text-gray-500">{f.club}</p>}
                </div>
                <div className="text-right">
                  <p className="font-mono font-bold text-white">{fmtRatio(f.hitRatio)}</p>
                  <p className="text-xs text-gray-500">
                    {f.blowsGiven}↑ {f.blowsReceived}↓
                  </p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-600 mt-2">
            Blow ratio = blows given ÷ blows received. Counts all afterblows regardless of afterblow
            mode (deductive or full).
          </p>
        </section>
      )}

      {/* ── Per-fighter detailed table ── */}
      {sorted.length > 0 && (
        <section>
          <h2
            className="text-xs font-bold uppercase tracking-widest mb-3"
            style={{ color: 'var(--event-accent, #f59e0b)' }}
          >
            Detailed stats
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500">
                  <th className="text-left py-2 pr-3 font-medium">Fighter</th>
                  <th className="text-center py-2 px-1.5 font-medium" title="Doubles">
                    Dbl
                  </th>
                  <th
                    className="text-center py-2 px-1.5 font-medium text-green-500"
                    title="Clean 1pt given"
                  >
                    ✓1
                  </th>
                  <th
                    className="text-center py-2 px-1.5 font-medium text-orange-400"
                    title="Afterblow 1pt given"
                  >
                    ✓1-1
                  </th>
                  <th
                    className="text-center py-2 px-1.5 font-medium text-green-500"
                    title="Clean 2pt given"
                  >
                    ✓2
                  </th>
                  <th
                    className="text-center py-2 px-1.5 font-medium text-orange-400"
                    title="Afterblow 2pt given"
                  >
                    ✓2-1
                  </th>
                  <th
                    className="text-center py-2 px-1.5 font-medium text-red-400"
                    title="Clean 1pt received"
                  >
                    ✗1
                  </th>
                  <th
                    className="text-center py-2 px-1.5 font-medium text-red-300"
                    title="Afterblow 1pt received (blow always counted)"
                  >
                    ✗1-1
                  </th>
                  <th
                    className="text-center py-2 px-1.5 font-medium text-red-400"
                    title="Clean 2pt received"
                  >
                    ✗2
                  </th>
                  <th
                    className="text-center py-2 px-1.5 font-medium text-red-300"
                    title="Afterblow 2pt received (blow always counted)"
                  >
                    ✗2-1
                  </th>
                  <th className="text-center py-2 px-1.5 font-medium" title="Total exchanges">
                    Tot
                  </th>
                  <th
                    className="text-right py-2 pl-2 font-medium"
                    title="Blow ratio (mode-independent)"
                  >
                    Ratio
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((f, idx) => (
                  <tr
                    key={f.registrationId}
                    className={[
                      'border-b border-gray-900',
                      idx === 0 ? 'text-white' : 'text-gray-300',
                    ].join(' ')}
                  >
                    <td className="py-2 pr-3">
                      <p className="font-medium leading-tight">
                        {f.givenName} {f.familyName}
                      </p>
                      {f.clubName && <p className="text-gray-600 text-xs">{f.clubName}</p>}
                    </td>
                    <td className="text-center py-2 px-1.5">{fmt(f.doubles)}</td>
                    <td className="text-center py-2 px-1.5 text-green-400">{fmt(f.hitsGiven1)}</td>
                    <td className="text-center py-2 px-1.5 text-orange-300">
                      {fmt(f.afterblowGiven1)}
                    </td>
                    <td className="text-center py-2 px-1.5 text-green-400">{fmt(f.hitsGiven2)}</td>
                    <td className="text-center py-2 px-1.5 text-orange-300">
                      {fmt(f.afterblowGiven2)}
                    </td>
                    <td className="text-center py-2 px-1.5 text-red-400">{fmt(f.hitsReceived1)}</td>
                    <td
                      className="text-center py-2 px-1.5 text-red-300"
                      title="Blow always counted regardless of afterblow mode"
                    >
                      {fmt(f.afterblowReceived1)}
                    </td>
                    <td className="text-center py-2 px-1.5 text-red-400">{fmt(f.hitsReceived2)}</td>
                    <td
                      className="text-center py-2 px-1.5 text-red-300"
                      title="Blow always counted regardless of afterblow mode"
                    >
                      {fmt(f.afterblowReceived2)}
                    </td>
                    <td className="text-center py-2 px-1.5">{fmt(f.totalExchanges)}</td>
                    <td className="text-right py-2 pl-2 font-mono font-bold">
                      {fmtRatio(f.hitRatio)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-600 mt-2">
            ✗1-1 and ✗2-1 columns count afterblow blows received regardless of afterblow mode. Ratio
            = blows given ÷ blows received (blow-based, mode-independent).
          </p>
        </section>
      )}

      {fighters.length === 0 && (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">📊</p>
          <p className="text-gray-400 text-sm">
            No stats yet. Stats appear once matches have been scored.
          </p>
        </div>
      )}
    </main>
  );
}
