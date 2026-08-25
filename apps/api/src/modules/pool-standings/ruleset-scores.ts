import { BadRequestException } from '@nestjs/common';
import type { AfterblowMode, Exchange, Ruleset } from '@myclash/rulesets';

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
 * Ranking stays with the service's `applyRanking(rows, rankingChain)` as the
 * single ordering authority — it also ranks the flattened cross-pool "overall"
 * view, where a per-pool sort would be meaningless.
 */
export function poolScoresByRegistration(
  ruleset: Ruleset,
  poolMembers: Array<{ registration_id: string }>,
  completedMatches: Array<{
    id: string;
    red_registration_id: string;
    blue_registration_id: string;
    winner_registration_id: string | null;
    end_reason: string | null;
  }>,
  exchangesByMatch: Map<string, Exchange[]>,
  afterblowMode: AfterblowMode,
  runtimeConfig: unknown,
): Map<string, number> {
  try {
    return ruleset.scorePoolFighters({
      registrationIds: poolMembers.map((m) => m.registration_id),
      // `ScoredMatch` is exactly this shape, so a PostgREST row maps onto it
      // field by field. This used to cast rows into `Match[]` and `Registration[]`
      // with `as unknown as`, invent a `Pool` of `{ id: '', name: '' }`, and then
      // read one of the six fields that came back.
      completedMatches: completedMatches.map((m) => ({
        id: m.id,
        redRegistrationId: m.red_registration_id,
        blueRegistrationId: m.blue_registration_id,
        winnerRegistrationId: m.winner_registration_id,
        // A double loss has no winner AND no points, so a ruleset reading
        // either would call it a draw. Only the reason can say otherwise.
        endReason: m.end_reason,
        exchanges: exchangesByMatch.get(m.id) ?? [],
      })),
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
