/**
 * swiss-board-units.ts — grouping a Swiss phase into assignable referee units.
 *
 * The referee board's assignable unit for a Swiss phase is one **(round ×
 * piste)** pair: the consecutive bouts of round N that run on lice L. That is
 * genuinely pool-shaped — one crew, one piste, back-to-back bouts — so the
 * rest and no-back-to-back constraints downstream stay meaningful, which they
 * would not if each Swiss bout were its own single-match unit.
 *
 * Kept pure and I/O-free so the grouping is table-testable without going
 * through `AssignmentBoardService`'s positional Supabase mock chain.
 */

import { runEndIso } from '../schedule/run-end';

export interface SwissUnitRound {
  id: string;
  phaseId: string;
  roundNumber: number;
}

export interface SwissUnitMatch {
  id: string;
  swissRoundId: string;
  liceId: string | null;
  scheduledAt: string | null;
  redRegistrationId: string | null;
  blueRegistrationId: string | null;
}

export interface SwissBoardUnit {
  /**
   * Board-wide unique id. Namespaced with `swiss-` for the same reason bracket
   * units use `match-`: the board merges units from three loaders into one
   * flat list keyed by id.
   */
  key: string;
  roundId: string;
  phaseId: string;
  roundNumber: number;
  liceId: string | null;
  /** Ordered by start time, then id — the order the crew works them. */
  matches: SwissUnitMatch[];
  scheduledStart: string | null;
  scheduledEnd: string | null;
}

/** Stable ordering: scheduled bouts by start time, unscheduled last, id breaks ties. */
function byStartThenId(a: SwissUnitMatch, b: SwissUnitMatch): number {
  if (a.scheduledAt !== b.scheduledAt) {
    if (a.scheduledAt === null) return 1;
    if (b.scheduledAt === null) return -1;
    return a.scheduledAt < b.scheduledAt ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Group a phase's Swiss matches into one unit per (round × piste).
 *
 * Bouts not yet placed on a piste (`liceId === null`) collect into a single
 * per-round `…-unscheduled` unit rather than being dropped: the board surfaces
 * them under "unscheduled" so a crew can still be pencilled in before the
 * schedule is generated.
 *
 * Matches whose `swissRoundId` has no matching round are skipped — a round can
 * be deleted while its matches are being re-read.
 */
export function groupSwissMatchesIntoUnits(
  rounds: SwissUnitRound[],
  matches: SwissUnitMatch[],
): SwissBoardUnit[] {
  const roundById = new Map(rounds.map((r) => [r.id, r]));
  const byKey = new Map<string, SwissBoardUnit>();

  for (const match of matches) {
    const round = roundById.get(match.swissRoundId);
    if (!round) continue;
    const key = `swiss-${round.id}-${match.liceId ?? 'unscheduled'}`;
    let unit = byKey.get(key);
    if (!unit) {
      unit = {
        key,
        roundId: round.id,
        phaseId: round.phaseId,
        roundNumber: round.roundNumber,
        liceId: match.liceId,
        matches: [],
        scheduledStart: null,
        scheduledEnd: null,
      };
      byKey.set(key, unit);
    }
    unit.matches.push(match);
  }

  const units = [...byKey.values()];
  for (const unit of units) {
    unit.matches.sort(byStartThenId);
    const starts = unit.matches
      .map((m) => m.scheduledAt)
      .filter((iso): iso is string => iso !== null);
    unit.scheduledStart = starts[0] ?? null;
    // Same end-time derivation pools use, so the referee board and the schedule
    // grid agree on when a Swiss round's piste frees up.
    unit.scheduledEnd = runEndIso(starts);
  }

  // Round order first so the board's unscheduled column reads 1, 2, 3…
  return units.sort(
    (a, b) => a.roundNumber - b.roundNumber || (a.liceId ?? '￿').localeCompare(b.liceId ?? '￿'),
  );
}

/**
 * Every registration competing in a round, across ALL its pistes.
 *
 * The overlap guard is deliberately round-scoped, not unit-scoped: a fighter
 * competing in round N must not referee round N whichever piste either of them
 * is on, because both run at the same time.
 */
export function registrationIdsByRound(matches: SwissUnitMatch[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const match of matches) {
    let set = out.get(match.swissRoundId);
    if (!set) {
      set = new Set<string>();
      out.set(match.swissRoundId, set);
    }
    if (match.redRegistrationId) set.add(match.redRegistrationId);
    if (match.blueRegistrationId) set.add(match.blueRegistrationId);
  }
  return out;
}
