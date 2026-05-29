/**
 * Tournament page — T-605
 * Route: /e/[eventSlug]/t/[tournamentSlug]
 *
 * SSR: fetch tournament + phases + initial standings + bracket.
 * Client: StandingsTable subscribes to Realtime for live updates.
 *
 * AC:
 *   ✓ Pool standings update live (Supabase Realtime)
 *   ✓ Bracket renders for 8/16/32 fighters
 *   ✓ Standings table matches lyonamhe.fr layout (V/Pts+/Pts−/Dbl/Score)
 */

/* eslint-disable myclash/no-literal-string */

import type { Metadata } from 'next';
import { getApiUrl } from '@/lib/api-url';
import { MedalPodium, type PodiumData } from '@myclash/ui';
import { StandingsTable } from './StandingsTable';
import { BracketView } from './BracketView';

interface Props {
  params: Promise<{ eventSlug: string; tournamentSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventSlug, tournamentSlug } = await params;
  const apiUrl = getApiUrl();
  const data = await fetchTournamentData(eventSlug, tournamentSlug, apiUrl);
  if (!data) return { title: `${tournamentSlug} · MyClash` };
  const fighterCount = data.pools.reduce((n, pool) => n + pool.standings.length, 0);
  return {
    title: `${data.tournament.name} · MyClash`,
    description: `${fighterCount} fighters · ${data.tournament.rulesetCode}`,
  };
}

// ── API types ─────────────────────────────────────────────────────────────────

export interface StandingRow {
  registrationId: string;
  fighterName: string;
  clubName: string | null;
  wins: number;
  losses: number;
  draws: number;
  pointsFor: number;
  pointsAgainst: number;
  doubles: number;
  score: number;
  seed: number;
}

export interface Pool {
  id: string;
  name: string;
  standings: StandingRow[];
}

export interface BracketSlot {
  id: string;
  round: number;
  position: number;
  redFighterName: string | null;
  blueFighterName: string | null;
  redScore: number | null;
  blueScore: number | null;
  status: string;
  matchId: string | null;
}

interface Tournament {
  id: string;
  name: string;
  weapon: string | null;
  rulesetCode: string;
  status: string;
}

interface TournamentData {
  tournament: Tournament;
  pools: Pool[];
  bracketSlots: BracketSlot[];
  bracketSize: number;
  playInMatchCount?: number;
  hasPlayInRound?: boolean;
  bracketRounds: number;
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchTournamentData(
  eventSlug: string,
  tournamentSlug: string,
  apiUrl: string,
): Promise<TournamentData | null> {
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/events/${eventSlug}/tournaments/${tournamentSlug}/standings`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null;
    return (await res.json()) as TournamentData;
  } catch {
    return null;
  }
}

// ── Podium derivation ─────────────────────────────────────────────────────────

/** Compute the gold/silver/bronze/4th from bracketSlots. By convention
 *  position 1 at maxRound is the final; position 2 (when present) is the
 *  bronze match. Returns undefined when no bracket data is available. */
function derivePodium(bracketSlots: BracketSlot[]): PodiumData | undefined {
  if (bracketSlots.length === 0) return undefined;
  const maxRound = bracketSlots.reduce((m, s) => Math.max(m, s.round), 0);
  const final = bracketSlots.find((s) => s.round === maxRound && s.position === 1) ?? null;
  const bronze = bracketSlots.find((s) => s.round === maxRound && s.position === 2) ?? null;
  if (!final && !bronze) return undefined;
  const winnerName = (s: BracketSlot | null) => {
    if (!s || s.status !== 'completed') return null;
    const rs = s.redScore ?? 0;
    const bs = s.blueScore ?? 0;
    if (rs === bs) return null;
    const name = rs > bs ? s.redFighterName : s.blueFighterName;
    return name ? { fighterName: name } : null;
  };
  const loserName = (s: BracketSlot | null) => {
    if (!s || s.status !== 'completed') return null;
    const rs = s.redScore ?? 0;
    const bs = s.blueScore ?? 0;
    if (rs === bs) return null;
    const name = rs > bs ? s.blueFighterName : s.redFighterName;
    return name ? { fighterName: name } : null;
  };
  return {
    gold: winnerName(final),
    silver: loserName(final),
    bronze: winnerName(bronze),
    fourth: loserName(bronze),
  };
}

// ── Tournament colour stripe ─────────────────────────────────────────────────

function colorTokenToHex(token: string | null | undefined): string {
  switch (token) {
    case 'red':
      return '#ef4444';
    case 'orange':
      return '#f97316';
    case 'amber':
      return '#f59e0b';
    case 'yellow':
      return '#eab308';
    case 'green':
      return '#22c55e';
    case 'teal':
      return '#14b8a6';
    case 'blue':
      return '#3b82f6';
    case 'violet':
      return '#8b5cf6';
    case 'purple':
      return '#a855f7';
    case 'pink':
      return '#ec4899';
    case 'gold':
      return '#facc15';
    case 'silver':
      return '#cbd5e1';
    case 'bronze':
      return '#d97706';
    default:
      return '#64748b';
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function TournamentPage({ params }: Props) {
  const { eventSlug, tournamentSlug } = await params;
  const apiUrl = getApiUrl();

  const data = await fetchTournamentData(eventSlug, tournamentSlug, apiUrl);

  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <p className="text-4xl mb-3">⚔️</p>
          <h1 className="text-xl font-bold text-white mb-2">Tournament not found</h1>
          <p className="text-gray-400 text-sm">
            Check the URL or come back when the schedule is published.
          </p>
        </div>
      </main>
    );
  }

  const { tournament, pools, bracketSlots, bracketSize, bracketRounds } = data;
  const podium = derivePodium(bracketSlots);
  const podiumDecided = !!(podium?.gold && podium.silver);
  const fighterCount = pools.reduce((n, pool) => n + pool.standings.length, 0);
  const tournamentColor = (tournament as { color?: string | null }).color ?? null;

  // Slice 4: section order adapts to tournament status so the most useful
  // answer leads.
  //   - completed → Podium first, then Bracket, then Pools.
  //   - running   → Bracket first, then Pools, then Podium (if any).
  //   - upcoming  → Pools first, then placeholders.
  const sections: Array<'podium' | 'bracket' | 'pools'> =
    tournament.status === 'completed'
      ? ['podium', 'bracket', 'pools']
      : tournament.status === 'running'
        ? ['bracket', 'pools', 'podium']
        : ['pools', 'bracket', 'podium'];

  const renderPools = () =>
    pools.length > 0 ? (
      <section key="pools" className="mb-8">
        <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-amber-400">
          Pool standings
        </h2>
        <div className="flex flex-col gap-6">
          {pools.map((pool) => (
            <StandingsTable
              key={pool.id}
              poolId={pool.id}
              poolName={pool.name}
              initialStandings={pool.standings}
              tournamentId={tournament.id}
              apiUrl={apiUrl}
            />
          ))}
        </div>
      </section>
    ) : (
      <section
        key="pools-placeholder"
        className="mb-8 rounded-xl border border-dashed border-gray-800 p-6 text-center text-sm text-gray-500"
      >
        Pool rosters will be published before the event starts.
      </section>
    );

  const renderBracket = () =>
    bracketSlots.length > 0 ? (
      <section key="bracket" className="mb-8">
        <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-amber-400">Bracket</h2>
        <p className="mb-2 text-xs text-gray-500 lg:hidden">
          Scroll horizontally to see the full bracket.
        </p>
        <div className="overflow-x-auto">
          <BracketView
            slots={bracketSlots}
            bracketSize={bracketSize}
            rounds={bracketRounds}
            eventSlug={eventSlug}
          />
        </div>
      </section>
    ) : (
      <section
        key="bracket-placeholder"
        className="mb-8 rounded-xl border border-dashed border-gray-800 p-6 text-center text-sm text-gray-500"
      >
        The bracket will be published once pools are decided.
      </section>
    );

  const renderPodium = () =>
    podiumDecided && podium ? (
      <section key="podium" className="mb-8 rounded-xl border border-gray-800 bg-gray-900 p-4">
        <MedalPodium podium={podium} showBronze={!!podium.bronze || !!podium.fourth} />
      </section>
    ) : null;

  return (
    <main className="mx-auto flex max-w-6xl flex-col px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-start gap-4">
        <div
          className="mt-2 h-12 w-1.5 rounded-full"
          style={{ backgroundColor: colorTokenToHex(tournamentColor) }}
          aria-hidden="true"
        />
        <div className="flex-1">
          <h1
            className="text-2xl font-bold sm:text-3xl"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--event-primary, #c0392b)' }}
          >
            {tournament.name}
          </h1>
          <p className="mt-0.5 text-sm text-gray-400">
            {tournament.weapon && `${tournament.weapon} · `}
            {tournament.rulesetCode}
            {fighterCount > 0 && ` · ${fighterCount} fighters`}
          </p>
        </div>
      </div>

      {sections.map((s) => {
        if (s === 'podium') return renderPodium();
        if (s === 'bracket') return renderBracket();
        if (s === 'pools') return renderPools();
        return null;
      })}

      {/* Empty state — only if we genuinely have nothing to show. */}
      {pools.length === 0 && bracketSlots.length === 0 && !podiumDecided && (
        <div className="py-12 text-center">
          <p className="mb-3 text-4xl">⏳</p>
          <p className="text-gray-400">
            Pools and bracket will appear here once the organizer generates them.
          </p>
        </div>
      )}
    </main>
  );
}
