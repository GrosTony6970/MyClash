/**
 * API payloads → the shapes the print builders consume.
 *
 * Pure and separate from the page so the mapping is unit-testable and so the
 * page stays a fetch-and-render shell. The two hard parts live here:
 *
 * 1. **Lice id → name.** `pools-with-matches` carries `lice_id`; the human name
 *    is only in `GET /events/:id/lices`. An unresolved id must render as "not
 *    assigned", never as a raw UUID on a sheet handed to a human.
 * 2. **Bout order.** Pools come before bracket rounds here, which is the order
 *    an unscheduled day is fought in. The piste sheet re-sorts by the clock
 *    once the bouts have times (`groupByPiste`); this order is what the pool
 *    and bracket sections keep, and the fallback when nothing is scheduled.
 */
import { sideKey } from '@myclash/types/side-key';
import type { PrintBracketRound, PrintMatch, PrintPool } from './print-types';

export interface ApiPoolMatch {
  id: string;
  round_number: number;
  red_name: string;
  blue_name: string;
  red_club_abbrev: string | null;
  blue_club_abbrev: string | null;
  /** A side is a Registration or a team (0284): the other is null, and the name is the team's. */
  red_registration_id: string | null;
  blue_registration_id: string | null;
  red_team_id: string | null;
  blue_team_id: string | null;
  lice_id: string | null;
  /** UTC ISO instant, or null when the bout has not been placed. */
  scheduled_at: string | null;
  roundCode: string;
  referees: Array<{ refereeName: string }>;
}

export interface ApiPoolWithMatches {
  poolId: string;
  poolName: string;
  matches: ApiPoolMatch[];
}

export interface ApiBracketSlot {
  round: number;
  position: number;
  redFighterName: string | null;
  blueFighterName: string | null;
  redClubAbbrev?: string | null;
  blueClubAbbrev?: string | null;
  liceId?: string | null;
  scheduledAt?: string | null;
  roundCode?: string | null;
  /** The bout's referees, as the bracket read resolves them (`displayName`, never an id). */
  referees?: Array<{ displayName: string | null }>;
}

/** `GET tournaments/:id/bracket`, as far as the pack reads it. */
export interface ApiBracket {
  bracketSize: number;
  /** Double elimination only: the winners and losers brackets' round counts. */
  wbRounds: number | null;
  lbRounds: number | null;
  slots: ApiBracketSlot[];
}

/** What names a bracket's rounds: its size, and its split when it is double elimination. */
export type BracketShape = Pick<ApiBracket, 'bracketSize' | 'wbRounds' | 'lbRounds'>;

export interface RoundNamer {
  /** Localized name for bracket round `round` of a bracket of this shape. */
  (round: number, shape: BracketShape): string;
}

/** Placeholder for an empty bracket side — a bye, or a slot not yet populated. */
const EMPTY_SIDE = '—';

function liceNameOf(
  liceId: string | null | undefined,
  lices: ReadonlyMap<string, string>,
): string | null {
  if (!liceId) return null;
  // An id with no matching lice renders as "not assigned" rather than as a
  // UUID: a raw id on paper tells a scorekeeper nothing and looks like a bug.
  return lices.get(liceId) ?? null;
}

export function poolsToPrint(
  pools: readonly ApiPoolWithMatches[],
  lices: ReadonlyMap<string, string>,
  unknownReferee: string,
): PrintPool[] {
  return pools.map((pool) => ({
    poolName: pool.poolName,
    fighters: rosterOf(pool),
    matches: pool.matches.map((match) => ({
      roundCode: match.roundCode,
      redName: match.red_name,
      blueName: match.blue_name,
      redClub: match.red_club_abbrev,
      blueClub: match.blue_club_abbrev,
      liceName: liceNameOf(match.lice_id, lices),
      scheduledAt: match.scheduled_at ?? null,
      // The server sends a blank name, never an id: the sheet says "Unknown referee".
      referees: match.referees.map((referee) => referee.refereeName.trim() || unknownReferee),
    })),
  }));
}

/**
 * The pool roster, derived from its bouts.
 *
 * `pools-with-matches` does not project the member list, and a round-robin
 * names every entrant at least once — so first-appearance order over the bouts
 * is the roster. Deduped by side key (`sideKey`): a Fighter's Registration or a
 * team, so two Fighters who share a name are both listed. A side not known yet
 * is nobody.
 */
function rosterOf(pool: ApiPoolWithMatches): Array<{ name: string; club: string | null }> {
  const seen = new Map<string, { name: string; club: string | null }>();
  for (const match of pool.matches) {
    const sides = [
      [
        sideKey(match.red_registration_id, match.red_team_id),
        match.red_name,
        match.red_club_abbrev,
      ],
      [
        sideKey(match.blue_registration_id, match.blue_team_id),
        match.blue_name,
        match.blue_club_abbrev,
      ],
    ] as const;
    for (const [key, name, club] of sides) {
      if (key && !seen.has(key)) seen.set(key, { name, club });
    }
  }
  return [...seen.values()];
}

export function bracketToPrint(
  slots: readonly ApiBracketSlot[],
  shape: BracketShape,
  lices: ReadonlyMap<string, string>,
  roundName: RoundNamer,
  unknownReferee: string,
): PrintBracketRound[] {
  const byRound = new Map<number, PrintMatch[]>();
  for (const slot of [...slots].sort(sortBySlot)) {
    const bucket = byRound.get(slot.round) ?? [];
    bucket.push({
      roundCode: slot.roundCode ?? `R${slot.round}-${slot.position}`,
      redName: slot.redFighterName ?? EMPTY_SIDE,
      blueName: slot.blueFighterName ?? EMPTY_SIDE,
      redClub: slot.redClubAbbrev ?? null,
      blueClub: slot.blueClubAbbrev ?? null,
      liceName: liceNameOf(slot.liceId, lices),
      scheduledAt: slot.scheduledAt ?? null,
      // As the pool sheets do: a blank name prints "Unknown referee", never an id.
      referees: (slot.referees ?? []).map(
        (referee) => referee.displayName?.trim() || unknownReferee,
      ),
    });
    byRound.set(slot.round, bucket);
  }
  return [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, matches]) => ({ roundName: roundName(round, shape), matches }));
}

function sortBySlot(a: ApiBracketSlot, b: ApiBracketSlot): number {
  return a.round - b.round || a.position - b.position;
}

/** Pools first, then bracket rounds — the order the bouts are fought. */
export function allMatchesOf(
  pools: readonly PrintPool[],
  bracketRounds: readonly PrintBracketRound[],
): PrintMatch[] {
  return [
    ...pools.flatMap((pool) => pool.matches),
    ...bracketRounds.flatMap((round) => round.matches),
  ];
}
