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
import { StandingsTable } from './StandingsTable';
import { BracketView } from './BracketView';

interface Props {
  params: Promise<{ eventSlug: string; tournamentSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tournamentSlug } = await params;
  return { title: tournamentSlug };
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function TournamentPage({ params }: Props) {
  const { eventSlug, tournamentSlug } = await params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

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

  return (
    <main className="px-4 py-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1
          className="text-2xl font-bold"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--event-primary, #c0392b)' }}
        >
          {tournament.name}
        </h1>
        <p className="text-gray-400 text-sm mt-0.5">
          {tournament.weapon && `${tournament.weapon} · `}
          {tournament.rulesetCode}
        </p>
      </div>

      {/* Pool standings — live via Realtime */}
      {pools.length > 0 && (
        <section className="mb-8">
          <h2
            className="text-xs font-bold uppercase tracking-widest mb-4"
            style={{ color: 'var(--event-accent, #f59e0b)' }}
          >
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
      )}

      {/* Bracket */}
      {bracketSlots.length > 0 && (
        <section>
          <h2
            className="text-xs font-bold uppercase tracking-widest mb-4"
            style={{ color: 'var(--event-accent, #f59e0b)' }}
          >
            Bracket
          </h2>
          <BracketView
            slots={bracketSlots}
            bracketSize={bracketSize}
            rounds={bracketRounds}
            eventSlug={eventSlug}
          />
        </section>
      )}

      {/* Empty state */}
      {pools.length === 0 && bracketSlots.length === 0 && (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">⏳</p>
          <p className="text-gray-400">
            Pools and bracket will appear here once the organizer generates them.
          </p>
        </div>
      )}
    </main>
  );
}
