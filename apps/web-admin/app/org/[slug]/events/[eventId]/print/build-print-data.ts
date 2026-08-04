/**
 * API payloads → the shapes the print builders consume.
 *
 * Pure and separate from the page so the mapping is unit-testable and so the
 * page stays a fetch-and-render shell. The two hard parts live here:
 *
 * 1. **Lice id → name.** `pools-with-matches` carries `lice_id`; the human name
 *    is only in `GET /events/:id/lices`. An unresolved id must render as "not
 *    assigned", never as a raw UUID on a sheet handed to a human.
 * 2. **Bout order.** The piste sheet groups by lice but keeps the order it is
 *    given, so pools have to come before bracket rounds here — that is the
 *    order the bouts are actually fought.
 */
import type { PrintBracketRound, PrintMatch, PrintPool } from './print-types';

export interface ApiPoolMatch {
  id: string;
  round_number: number;
  red_name: string;
  blue_name: string;
  red_club_abbrev: string | null;
  blue_club_abbrev: string | null;
  red_registration_id: string;
  blue_registration_id: string;
  lice_id: string | null;
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
  roundCode?: string | null;
}

export interface RoundNamer {
  /** Localized name for bracket round `round` of `rounds` total. */
  (round: number, rounds: number): string;
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
      referees: match.referees.map((referee) => referee.refereeName).filter(Boolean),
    })),
  }));
}

/**
 * The pool roster, derived from its bouts.
 *
 * `pools-with-matches` does not project the member list, and a round-robin
 * names every fighter at least once — so first-appearance order over the bouts
 * is the roster. Deduped by name because that is the only identity the payload
 * carries on both sides of a bout.
 */
function rosterOf(pool: ApiPoolWithMatches): Array<{ name: string; club: string | null }> {
  const seen = new Map<string, string | null>();
  for (const match of pool.matches) {
    if (!seen.has(match.red_name)) seen.set(match.red_name, match.red_club_abbrev);
    if (!seen.has(match.blue_name)) seen.set(match.blue_name, match.blue_club_abbrev);
  }
  return [...seen.entries()].map(([name, club]) => ({ name, club }));
}

export function bracketToPrint(
  slots: readonly ApiBracketSlot[],
  rounds: number,
  lices: ReadonlyMap<string, string>,
  roundName: RoundNamer,
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
      referees: [],
    });
    byRound.set(slot.round, bucket);
  }
  return [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, matches]) => ({ roundName: roundName(round, rounds), matches }));
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
