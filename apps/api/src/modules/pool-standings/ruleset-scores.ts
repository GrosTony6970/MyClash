import { BadRequestException } from '@nestjs/common';
import type { Exchange, Match, Pool, Registration, Ruleset } from '@myclash/rulesets';

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
 * Delegating to `ruleset.computePoolStandings` fixes that for every ruleset at
 * once: TF_v1 runs its published algorithm, Generic_PointsCap its wins/diff
 * ordering, and a FormulaRuleset evaluates the AST the organiser authored.
 *
 * Only the scores are taken from the returned rows. Ranking stays with the
 * service's `applyRanking(rows, rankingChain)` as the single ordering
 * authority — it also ranks the flattened cross-pool "overall" view, where a
 * per-pool sort would be meaningless.
 */
export function poolScoresByRegistration(
  ruleset: Ruleset,
  poolMembers: Array<{ registration_id: string }>,
  completedMatches: Array<{
    id: string;
    red_registration_id: string;
    blue_registration_id: string;
    winner_registration_id: string | null;
  }>,
  exchangesByMatch: Map<string, Exchange[]>,
  runtimeConfig: unknown,
): Map<string, number> {
  // computePoolStandings reads only these fields off a match, plus the
  // exchanges attached to it; a minimal shape keeps the cast honest. Seed and
  // bib are omitted deliberately: they only break ties in the ruleset's own
  // sort, and that ordering is discarded — the service does the ranking.
  const matches = completedMatches.map((m) => ({
    id: m.id,
    status: 'completed',
    redRegistrationId: m.red_registration_id,
    blueRegistrationId: m.blue_registration_id,
    winnerRegistrationId: m.winner_registration_id,
    exchanges: exchangesByMatch.get(m.id) ?? [],
  })) as unknown as Match[];

  const registrations = poolMembers.map((m) => ({
    id: m.registration_id,
    seed: null,
    bibNumber: null,
  })) as unknown as Registration[];

  try {
    const rows = ruleset.computePoolStandings(
      { id: '', name: '' } as unknown as Pool,
      matches,
      registrations,
      runtimeConfig,
    );
    return new Map(rows.map((row) => [row.registrationId, row.score]));
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
