import { NotFoundException } from '@nestjs/common';
import type { McpCaller, McpRefusal, McpToolDeps } from '../mcp-server';
import { readableEventBySlug } from './readable-event';

export interface TournamentStandingsAnswer {
  tournament: { name: string; status: string };
  pools: {
    name: string;
    status: string;
    rows: {
      rank: number;
      name: string;
      club: string | null;
      /** The ruleset's own columns by their header label (Wins, Doubles, Score...). */
      stats: Record<string, number | string>;
    }[];
  }[];
  bracket: {
    round: string;
    fights: {
      red: string | null;
      blue: string | null;
      winner: string | null;
      score: { red: number | null; blue: number | null } | null;
      status: string;
    }[];
  }[];
}

/** The slice of the public standings this tool reads; the rest holds registration ids. */
interface PublicStandings {
  tournament: { id: string; name: string; status: string };
  pools: unknown[];
  phaseType?: string;
  bracketRounds?: number;
  bracketSlots: {
    round: number;
    position: number;
    redFighterName: string | null;
    blueFighterName: string | null;
    redScore: number | null;
    blueScore: number | null;
    winnerRegistrationId: string | null;
    redRegistrationId: string | null;
    blueRegistrationId: string | null;
    status: string;
  }[];
}

type PoolTables = Extract<
  Awaited<ReturnType<McpToolDeps['poolStandings']['getPoolStandings']>>,
  { pools: unknown }
>;

/** A single-elimination round is named by its distance from the end; any other is numbered. */
function roundLabel(round: number, s: PublicStandings): string {
  const last = s.bracketRounds ?? 0;
  if (s.phaseType === 'single_elim' && last >= 2) {
    if (round === last) return 'Final';
    if (round === last - 1) return 'Semi-final';
  }
  return `Round ${round}`;
}

function toPools(tables: PoolTables): TournamentStandingsAnswer['pools'] {
  return tables.pools.map((pool) => ({
    name: pool.poolName,
    status: pool.status,
    rows: pool.rows.map((row) => ({
      rank: row.rank,
      name: row.displayName,
      club: row.club ? (row.club.abbreviation ?? row.club.name) : null,
      stats: Object.fromEntries(
        tables.columns.flatMap((c) => (c.key in row.stats ? [[c.label, row.stats[c.key]!]] : [])),
      ),
    })),
  }));
}

function toBracket(s: PublicStandings): TournamentStandingsAnswer['bracket'] {
  const rounds = new Map<number, PublicStandings['bracketSlots']>();
  for (const slot of s.bracketSlots)
    rounds.set(slot.round, [...(rounds.get(slot.round) ?? []), slot]);
  return [...rounds.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, slots]) => ({
      round: roundLabel(round, s),
      fights: slots
        .sort((a, b) => a.position - b.position)
        .map((slot) => {
          const won = slot.winnerRegistrationId;
          const winner =
            won === null
              ? null
              : won === slot.redRegistrationId
                ? slot.redFighterName
                : won === slot.blueRegistrationId
                  ? slot.blueFighterName
                  : null;
          const scored = slot.redScore !== null || slot.blueScore !== null;
          return {
            red: slot.redFighterName,
            blue: slot.blueFighterName,
            winner,
            score: scored ? { red: slot.redScore, blue: slot.blueScore } : null,
            status: slot.status,
          };
        }),
    }));
}

/**
 * A Tournament's public pool tables and bracket: what `/e/<slug>/t/<slug>` shows. The Event is
 * gated first so an unknown or hidden Event gets the Event's refusal. The standings service then
 * gates the Tournament (a draft one is a NotFound); that is the only error read as "unknown".
 */
export async function tournamentStandings(
  eventSlug: string,
  tournamentSlug: string,
  caller: McpCaller,
  deps: McpToolDeps,
): Promise<TournamentStandingsAnswer | McpRefusal> {
  const event = await readableEventBySlug(eventSlug, caller, deps);
  if (!event) return { refusal: `No Event "${eventSlug}" that you can see.` };

  const reader = { userId: caller.userId, staff: null };
  let standings: PublicStandings;
  try {
    standings = (await deps.events.getPublicTournamentStandings(
      event.slug,
      tournamentSlug,
      reader,
    )) as unknown as PublicStandings;
  } catch (error) {
    if (error instanceof NotFoundException) {
      return { refusal: `No Tournament "${tournamentSlug}" at ${event.name} that you can see.` };
    }
    throw error;
  }

  // The public page's win/loss tables come from the pool-standings read, not from the payload
  // above (its pools carry members only). The Tournament was gated by the call above; a
  // Tournament with no pools shown has no table to read.
  const tables =
    standings.pools.length > 0
      ? ((await deps.poolStandings.getPoolStandings(
          standings.tournament.id,
          'by-pool',
        )) as PoolTables)
      : null;
  return {
    tournament: { name: standings.tournament.name, status: standings.tournament.status },
    pools: tables ? toPools(tables) : [],
    bracket: toBracket(standings),
  };
}
