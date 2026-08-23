/**
 * swiss-snapshot.ts — rounds and results in, pairing input out.
 *
 * Pure: no DB, no Nest, no I/O. The services load the rows, this decides what
 * they mean. Split out so the rules that actually govern a Swiss phase — what a
 * bye is worth, whether a withdrawn fighter still counts, when two people have
 * "met" — are testable without a Supabase mock, and so the pairing engine's
 * input can be reasoned about on its own.
 *
 * The RANK this produces is the pairing rank: Swiss points, then the round-1
 * draw order. That is deliberately not the full standings — Buchholz, the
 * ruleset score and the configurable tiebreak chain decide the STANDINGS, and
 * the standings service owns them. Pairing needs only a deterministic order
 * within and across point groups.
 */

import type { SwissPlayer } from '@myclash/rules';
import type { SwissConfig } from './dto/swiss-config.dto';

export interface SwissMatchRecord {
  id: string;
  redRegistrationId: string | null;
  blueRegistrationId: string | null;
  winnerRegistrationId: string | null;
  status: string;
  /** `matches.end_reason` — 'max_doubles' means BOTH fighters lost. */
  endReason: string | null;
}

export interface SwissRoundRecord {
  id: string;
  roundNumber: number;
  status: string;
  byeRegistrationId: string | null;
  /**
   * `swiss_rounds.pairing_meta_json` — the engine warnings, the ranked snapshot
   * and the manual adjustments. Declared rather than left implicit: the loader
   * has always populated it, and every consumer was reaching it through a cast,
   * which is how a field ends up silently renamed on one side.
   */
  pairingMeta: Record<string, unknown> | null;
  matches: SwissMatchRecord[];
}

export interface SwissEntrantRecord {
  registrationId: string;
  /** Set once the fighter withdrew; they take no part from that round on. */
  withdrawnAtRound: number | null;
}

export type SwissPoints = SwissConfig['points'];

/**
 * Entrants still available to be paired.
 *
 * A withdrawal is not an erasure: the rounds they already played stand, still
 * decide their opponents' records, and still appear in the standings. They are
 * simply not dealt into another round.
 */
export function activeEntrants(
  entrants: SwissEntrantRecord[],
  nextRoundNumber: number,
): SwissEntrantRecord[] {
  return entrants.filter(
    (e) => e.withdrawnAtRound === null || e.withdrawnAtRound > nextRoundNumber,
  );
}

/**
 * Swiss points, opponents faced, byes taken and pairing rank for every entrant.
 *
 * `seedOrder` is the round-1 draw order, persisted on round 1 so later rounds
 * break point ties the same way every time. Without it the tie would fall back
 * to registration id, and a regenerated round could reorder fighters who are
 * genuinely level — the draw has to be reproducible to be defensible.
 */
export function buildSwissPlayers(
  entrants: SwissEntrantRecord[],
  rounds: SwissRoundRecord[],
  points: SwissPoints,
  seedOrder: string[] = [],
): SwissPlayer[] {
  const ids = entrants.map((e) => e.registrationId);
  const { total, opponents, byes } = accumulate(ids, rounds, points);

  const seedIndex = new Map(seedOrder.map((id, i) => [id, i]));
  const seedOf = (id: string) => seedIndex.get(id) ?? Number.MAX_SAFE_INTEGER;

  return [...ids]
    .sort(
      (a, b) =>
        (total.get(b) ?? 0) - (total.get(a) ?? 0) ||
        seedOf(a) - seedOf(b) ||
        (a < b ? -1 : a > b ? 1 : 0),
    )
    .map((registrationId, index) => ({
      registrationId,
      points: total.get(registrationId) ?? 0,
      // Score-band grouping needs the ruleset score; the standings service
      // supplies it when the phase is configured that way. Null here means
      // "not loaded", and bandsOf sorts a null into the lowest band.
      score: null,
      opponentIds: opponents.get(registrationId) ?? [],
      hadBye: byes.has(registrationId),
      rank: index + 1,
    }));
}

/**
 * Walk every round once, accumulating points, opponents and byes.
 *
 * Results belonging to fighters outside `ids` are read but not credited — a
 * withdrawn opponent's bout still counts as a meeting (so the pairing will not
 * recreate it) without resurrecting them into the field.
 */
function accumulate(
  ids: string[],
  rounds: SwissRoundRecord[],
  points: SwissPoints,
): { total: Map<string, number>; opponents: Map<string, string[]>; byes: Set<string> } {
  const known = new Set(ids);
  const total = new Map(ids.map((id) => [id, 0]));
  const opponents = new Map<string, string[]>(ids.map((id) => [id, []]));
  const byes = new Set<string>();

  for (const round of rounds) {
    if (round.byeRegistrationId && known.has(round.byeRegistrationId)) {
      byes.add(round.byeRegistrationId);
      total.set(round.byeRegistrationId, (total.get(round.byeRegistrationId) ?? 0) + points.bye);
    }

    for (const match of round.matches) {
      const { redRegistrationId: red, blueRegistrationId: blue } = match;
      if (!red || !blue) continue;

      // Opponents are recorded for EVERY pairing, complete or not. Two people
      // scheduled against each other have met for rematch purposes even if the
      // bout has not been fought yet — otherwise a preview of the next round
      // could pair them again while they are standing on the piste.
      if (known.has(red)) opponents.get(red)!.push(blue);
      if (known.has(blue)) opponents.get(blue)!.push(red);

      if (match.status !== 'completed') continue;
      const [redPoints, bluePoints] = outcomePoints(match, points);
      if (known.has(red)) total.set(red, (total.get(red) ?? 0) + redPoints);
      if (known.has(blue)) total.set(blue, (total.get(blue) ?? 0) + bluePoints);
    }
  }
  return { total, opponents, byes };
}

/** Points for (red, blue) from one completed match. */
function outcomePoints(match: SwissMatchRecord, points: SwissPoints): [number, number] {
  // A double-cap ending is a mutual loss, not a draw — both fighters failed to
  // win it. Mirrors how the HEMA Ratings export reports the same end reason.
  if (match.endReason === 'max_doubles') return [points.loss, points.loss];
  if (match.winnerRegistrationId === null) return [points.draw, points.draw];
  return match.winnerRegistrationId === match.redRegistrationId
    ? [points.win, points.loss]
    : [points.loss, points.win];
}

export interface SwissRoundValidation {
  valid: boolean;
  /** Fighters appearing more than once in the round. */
  duplicated: string[];
  /** Active entrants appearing nowhere — neither paired nor given the bye. */
  missing: string[];
  /** Fighters in the round who are not active entrants of this phase. */
  unknown: string[];
}

/**
 * Is this round still a legal Swiss round?
 *
 * The swap override cannot break these invariants — it exchanges two fighters,
 * so everyone still appears exactly once by construction. `setMatchSides` CAN:
 * it is the escape hatch, it writes whoever it is told to, and it is the reason
 * this function exists. Every override runs it, an invalid round is reported on
 * the round card, and committing the next round is blocked until it is fixed —
 * pairing round N+1 from a round N where somebody fought twice would carry the
 * error forward into every subsequent round.
 */
export function validateSwissRound(
  activeEntrantIds: string[],
  matches: Array<Pick<SwissMatchRecord, 'redRegistrationId' | 'blueRegistrationId'>>,
  byeRegistrationId: string | null,
): SwissRoundValidation {
  const expected = new Set(activeEntrantIds);
  const seen = new Map<string, number>();

  const note = (id: string | null) => {
    if (!id) return;
    seen.set(id, (seen.get(id) ?? 0) + 1);
  };
  for (const match of matches) {
    note(match.redRegistrationId);
    note(match.blueRegistrationId);
  }
  note(byeRegistrationId);

  const duplicated = [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort();
  const unknown = [...seen.keys()].filter((id) => !expected.has(id)).sort();
  const missing = [...expected].filter((id) => !seen.has(id)).sort();

  return {
    valid: duplicated.length === 0 && unknown.length === 0 && missing.length === 0,
    duplicated,
    missing,
    unknown,
  };
}

/**
 * Why a round is not a legal Swiss round, in words — or null when it is fine.
 *
 * Split from the validation itself so the pairing service can refuse to build on
 * a broken round without owning the phrasing, and so the phrasing is testable
 * without a Supabase mock.
 */
export function describeInvalidRound(validation: SwissRoundValidation): string | null {
  if (validation.valid) return null;
  return [
    validation.duplicated.length > 0 ? `fighting twice: ${validation.duplicated.join(', ')}` : '',
    validation.missing.length > 0 ? `not in the round: ${validation.missing.join(', ')}` : '',
    validation.unknown.length > 0 ? `not an entrant: ${validation.unknown.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; ');
}
