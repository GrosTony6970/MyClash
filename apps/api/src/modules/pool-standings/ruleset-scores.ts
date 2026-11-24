import { BadRequestException } from '@nestjs/common';
import type { AfterblowMode, Exchange, Ruleset } from '@myclash/rulesets';
import { sideKey } from '@myclash/types/side-key';
import { boutSideKeys, seatKey, type CompletedBout, type StandingsMember } from './pool-rows';

/**
 * Per-fighter `score` for one pool, computed by the ACTIVE ruleset.
 *
 * The standings service derives every other column itself (W/L/D/F, points,
 * differential, doubles, hits) because those are generic — they fall out of
 * match scores, exchanges and forfeits regardless of ruleset. `score` is the
 * one ruleset-specific column, and it used to be filled by calling TF_v1's
 * computeScore directly, which silently ranked an org-authored pool by the
 * federal formula instead of the author's own `scoreFormula`.
 *
 * Delegating to the ruleset fixes that for every ruleset at once: TF_v1 runs
 * its published algorithm, Generic_PointsCap its wins/diff ordering, and a
 * FormulaRuleset evaluates the AST the organiser authored.
 *
 * The STORED scores travel with the bout so a ruleset scores what was fought
 * rather than a total re-derived from the exchanges — which see no penalty, no
 * forfeit policy and no doubles-ceiling zeroing.
 *
 * Ranking stays with the service's `applyRanking(rows, rankingChain)` as the
 * single ordering authority — it also ranks the flattened cross-pool "overall"
 * view, where a per-pool sort would be meaningless.
 */
export function poolScoresByRegistration(
  ruleset: Ruleset,
  poolMembers: StandingsMember[],
  completedMatches: CompletedBout[],
  exchangesByMatch: Map<string, Exchange[]>,
  afterblowMode: AfterblowMode,
  runtimeConfig: unknown,
): Map<string, number> {
  try {
    return ruleset.scorePoolFighters({
      // Each entrant and each side by its side key: a Registration or a team (0282).
      entrantIds: poolMembers.map(seatKey),
      // `ScoredMatch` is exactly this shape, so a PostgREST row maps onto it
      // field by field. This used to cast rows into `Match[]` and `Registration[]`
      // with `as unknown as`, invent a `Pool` of `{ id: '', name: '' }`, and then
      // read one of the six fields that came back. A bout with a side not known
      // scores for nobody, as in `computeStandingsRows`.
      completedMatches: completedMatches.flatMap((m) => {
        const sides = boutSideKeys(m);
        if (!sides) return [];
        return [
          {
            id: m.id,
            ...sides,
            winnerSideId: sideKey(m.winner_registration_id, m.winner_team_id),
            // A double loss has no winner AND no points, so a ruleset reading
            // either would call it a draw. Only the reason can say otherwise.
            endReason: m.end_reason,
            redScore: m.red_score,
            blueScore: m.blue_score,
            exchanges: exchangesByMatch.get(m.id) ?? [],
          },
        ];
      }),
      afterblowMode,
      config: runtimeConfig,
    });
  } catch (err) {
    // A malformed org-authored formula must not surface as an opaque 500 on a
    // page the organiser has no way to debug.
    throw new BadRequestException(
      `Ruleset ${ruleset.code} v${ruleset.version} failed to compute standings: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
