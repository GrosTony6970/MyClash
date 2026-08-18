import type { SwissRoundPlan } from '@myclash/rulesets/dist/scheduling/index';
import type { MatchRulesetStamp } from '../phases/match-ruleset';

/**
 * The `SW-R<round>-M<board>` label every Swiss bout carries.
 *
 * One owner for the format, because the number inside it is read back out:
 * `boardNumber` (`swiss-public-rounds.map.ts`) parses the tail to order the
 * public and admin round views, and `formatRoundCode` (`@myclash/types`) takes
 * the same tail into the code an operator announces.
 *
 * The board is zero-padded to the width of its own round's board count, the
 * way the Berger generator pads a pool's sequence (`berger.ts`). Two reads
 * order matches by `match_number_label` in SQL — `MatchesService.listByPhase`
 * and the schedule grid — and Postgres sorts that column as TEXT, so board 10
 * came back ahead of board 2 as soon as a round had ten bouts. A twenty-
 * fighter field is ten boards, so that is the ordinary case for a large Swiss
 * rather than an edge.
 *
 * Padding per ROUND is enough: the round segment differs first, so a label
 * only ever competes with others of its own round, and those all share a
 * width. The round number itself needs none — `roundCount` is capped at 9.
 * Consumers that read the number back parse it with `Number`, which ignores
 * the zeros.
 */
function swissMatchLabel(roundNumber: number, board: number, boardsInRound: number): string {
  return `SW-R${roundNumber}-M${String(board).padStart(String(boardsInRound).length, '0')}`;
}

/**
 * The `matches` rows one committed Swiss round inserts, in board order.
 *
 * Pure, and separate from the insert that writes them: what a Swiss bout looks
 * like is a decision about the format, while the insert is plumbing. `stamp`
 * is the tournament's ruleset, resolved by the caller because it needs a
 * database read.
 */
export function swissMatchRows(
  phaseId: string,
  roundId: string,
  roundNumber: number,
  plan: SwissRoundPlan,
  stamp: MatchRulesetStamp,
): Array<Record<string, unknown>> {
  return plan.pairings.map((pairing) => ({
    phase_id: phaseId,
    swiss_round_id: roundId,
    red_registration_id: pairing.aId,
    blue_registration_id: pairing.bId,
    status: 'scheduled',
    match_number_label: swissMatchLabel(roundNumber, pairing.board, plan.pairings.length),
    ...stamp,
  }));
}
