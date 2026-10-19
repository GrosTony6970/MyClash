import type { Logger } from '@nestjs/common';
import type { DecisionEdition, MatchFormatConfig, Ruleset } from '@myclash/rulesets';
import type { TournamentScoringConfig } from '@myclash/types';
import { normalizeRulesetVersion } from '../events/ruleset-row-projection';
import { normalizeTournamentScoringConfig } from '../events/tournament-config';
import { afterblowModeOf, boutRulesOf, cardPinOf } from './bout-rules';
import type { RulesetResolver } from './ruleset-resolver.service';
import { scoredMatchFormat } from './scored-match-format';

/**
 * The rules a bout scores with, as the pad needs them (ruling K, 2026-10-18: the bout read
 * carries its own rules). Read from the bout's copy of its rules (0229) by the scorer's own
 * readers: the pad may not import the engine, so the server answers the format it plays.
 */
export interface BoutAnswerRules {
  /** The copy these rules are read from (`match_rules_id`): a Start names it (`startCopyOf`). */
  id: string;
  matchFormat: MatchFormatConfig;
  afterblowMode: TournamentScoringConfig['afterblowMode'];
  buttons: TournamentScoringConfig['buttons'];
  /** The card ruleset the copy pins; null reads as the built-in (the copy names none, or a delete
   *  set its pin NULL). */
  cardRulesetId: string | null;
}

export type BoutAnswer = Record<string, unknown> & {
  decision_edition?: DecisionEdition;
  rules?: BoutAnswerRules;
};

/**
 * A bout row as the scoring pad reads it. The row is read with its copy embedded
 * (`match_rules(ruleset_config, scoring_config_json, penalty_ruleset_id)`); the answer carries,
 * in place of that embed:
 *   - `decision_edition`, the end-decision edition of the pair the scorer decides the bout with:
 *     the pad decides an End, a round and the winner at the cap with no network, and must decide
 *     as the server will. Until the three old columns go (foundation commit 6) the scorer reads
 *     the row's own `ruleset_code` / `ruleset_version` (`rulesetMatch`), and so does this;
 *   - `rules`, the copy's id, its format (with that same pair's doubles rule), its afterblow mode,
 *     its buttons and its card pin. Display stays on the Tournament (`/match-config`). A Start
 *     names that id: the copy the screen showed (`startCopyOf`).
 *
 * The one owner for both routes a bout reaches the pad by: `GET /matches/:id` and the read of a
 * whole piste. Whatever fails here — no resolver wired, a pair that does not resolve, a read that
 * fails, no copy, a format the schema refuses — is logged and leaves the field out: a bout read
 * never turns into a server error over it, since the pad does not open a bout on a 5xx, and one
 * bad bout must not fail the read of its whole piste. The pad then falls back to its Tournament's
 * rules and says they are not confirmed.
 */
export async function withBoutRules(
  row: Record<string, unknown>,
  rulesets: RulesetResolver | undefined,
  logger: Pick<Logger, 'warn'>,
): Promise<BoutAnswer> {
  const { match_rules: _copy, ...bout } = row;
  const id = String(bout['id']);
  if (!rulesets) {
    logger.warn(`Bout ${id}: no ruleset resolver wired; no edition and no rules sent`);
    return bout;
  }
  const code = String(bout['ruleset_code']);
  const version = normalizeRulesetVersion(String(bout['ruleset_version']));
  let ruleset: Ruleset | null;
  try {
    ruleset = await rulesets.resolve(code, version);
  } catch (err) {
    logger.warn(`Bout ${id}: the edition of ${code}@${version} was not read: ${String(err)}`);
    return bout;
  }
  if (!ruleset) {
    logger.warn(`Bout ${id}: ${code}@${version} does not resolve; no edition and no rules sent`);
    return bout;
  }
  const answer: BoutAnswer = { ...bout, decision_edition: ruleset.decisionEdition };
  try {
    return { ...answer, rules: rulesOf(row, ruleset) };
  } catch (err) {
    // No copy (`boutRulesOf`), or a format the schema refuses (`scoredMatchFormat`).
    logger.warn(`Bout ${id}: no rules sent: ${err instanceof Error ? err.message : String(err)}`);
    return answer;
  }
}

/** Through the scorer's own readers of a copy (`bout-rules.ts`), so the pad decides as it nets. */
function rulesOf(row: Record<string, unknown>, ruleset: Ruleset): BoutAnswerRules {
  const rules = boutRulesOf(row);
  const id = row['match_rules_id'];
  if (typeof id !== 'string')
    throw new Error(`Bout ${String(row['id'])} names no copy of its rules`);
  return {
    id,
    matchFormat: scoredMatchFormat(rules.rulesetConfig, ruleset),
    afterblowMode: afterblowModeOf(rules),
    // The copy holds no display: of what the normalizer adds, only the buttons are sent.
    buttons: normalizeTournamentScoringConfig(rules.scoringConfig).buttons,
    cardRulesetId: cardPinOf(row),
  };
}
