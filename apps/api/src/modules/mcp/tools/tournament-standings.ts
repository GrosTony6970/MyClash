import { NotFoundException } from '@nestjs/common';
import { createTranslator, messages } from '@myclash/i18n';
import { bracketToken, roundTokenLabel } from '@myclash/types';
import type { McpCaller, McpRefusal, McpToolDeps } from '../mcp-server';
import { poolTableRows, type PoolTables } from '../../pool-standings/pool-table-rows';
import { noEventRefusal, noTournamentRefusal, readableEventBySlug } from './readable-event';

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
  /**
   * Set when the Tournament runs a Swiss phase. Its round standings are not listed: only that it
   * runs Swiss and how far it is.
   */
  swiss: { rounds: number; roundsCompleted: number } | null;
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
  bracketSize?: number;
  wbRounds?: number | null;
  lbRounds?: number | null;
  phaseType?: string;
  swissPhaseId?: string | null;
  swissRoundCount?: number;
  swissRoundsCompleted?: number;
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

const english = createTranslator(messages.en);

/**
 * A round named as the app names it: the match-code token (`SF`, `LB2`, `GF`, `PI`) from
 * `bracketToken`, in English through `roundTokenLabel`. A round the token cannot name is numbered.
 */
function roundLabel(round: number, s: PublicStandings): string {
  const token = bracketToken({
    bracketRound: round,
    bracketSize: s.bracketSize ?? null,
    wbRounds: s.wbRounds ?? null,
    lbRounds: s.lbRounds ?? null,
  });
  const descriptor = roundTokenLabel(token);
  return descriptor ? english(descriptor.key, descriptor.params) : `Round ${round}`;
}

/**
 * The bronze bout: position 2 of the last round (the gold final is position 0). The public page
 * takes it out the same way with `extractBronzeMatch` (packages/ui bracket/extract-bronze-match.ts)
 * and shows it apart; the API cannot import packages/ui, so this is the same predicate. The
 * public page skips the split for double elimination (BracketLive.tsx), and so does `toBracket`.
 */
function isBronze(slot: PublicStandings['bracketSlots'][number], maxRound: number): boolean {
  return slot.round === maxRound && slot.position === 2;
}

function toBracket(s: PublicStandings): TournamentStandingsAnswer['bracket'] {
  const maxRound = s.bracketSlots.reduce((max, slot) => Math.max(max, slot.round), 0);
  const rounds = new Map<number, PublicStandings['bracketSlots']>();
  const bronze: PublicStandings['bracketSlots'] = [];
  const splitBronze = s.phaseType !== 'double_elim';
  for (const slot of s.bracketSlots) {
    if (splitBronze && isBronze(slot, maxRound)) bronze.push(slot);
    else rounds.set(slot.round, [...(rounds.get(slot.round) ?? []), slot]);
  }
  const named = [...rounds.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, slots]) => ({ round: roundLabel(round, s), slots }));
  if (bronze.length > 0)
    named.push({ round: english('common.bracket.bronzeMatch'), slots: bronze });
  return named.map(({ round, slots }) => ({
    round,
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
  if (!event) return noEventRefusal(eventSlug);

  const reader = { userId: caller.userId, staff: null };
  let standings: PublicStandings;
  try {
    standings = (await deps.events.getPublicTournamentStandings(
      event.slug,
      tournamentSlug,
      reader,
    )) as unknown as PublicStandings;
  } catch (error) {
    if (error instanceof NotFoundException) return noTournamentRefusal(tournamentSlug, event);
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
    pools: tables ? poolTableRows(tables) : [],
    swiss: standings.swissPhaseId
      ? {
          rounds: standings.swissRoundCount ?? 0,
          roundsCompleted: standings.swissRoundsCompleted ?? 0,
        }
      : null,
    bracket: toBracket(standings),
  };
}
