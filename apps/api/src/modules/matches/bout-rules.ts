/**
 * A bout's copy of its rules (migration 0229): what every scoring read of a bout decides with.
 *
 * Rulings (operator, 2026-10-17): a bout keeps everything it started under, the engine, the
 * settings and the card rules; a finished bout keeps the rules it ended under. So a scoring read
 * of a bout embeds its copy from its `matches` row (`BOUT_RULES`), never its Tournament's settings
 * of now. The tables, the stats, the TV and the forfeits follow the Tournament (rulings "Tables",
 * A): they do not read this.
 *
 * Every bout holds a copy: each door that makes one stamps it, and two backfills gave one to every
 * bout made before (0229, 0230). A bout with none is a fault: it is refused loudly, never scored
 * with its Tournament's rules of now.
 */

import { afterblowModeInForce } from '@myclash/types';
import { normalizeRulesetVersion } from '../events/ruleset-row-projection';

/** A PostgREST embed arrives as an object or a one-element array. */
export function asRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === 'object' ? (row as Record<string, unknown>) : null;
}

/** The embed of a `matches` read that carries the bout's copy: its engine pair and its settings. */
export const BOUT_RULES =
  'match_rules(ruleset_code, ruleset_version, ruleset_config, scoring_config_json)';

export interface BoutRules {
  /** The Tournament's `ruleset_config` when the copy was made. */
  rulesetConfig: Record<string, unknown>;
  /** Of its `scoring_config_json`, the two keys that score: `afterblowMode` and `buttons`. */
  scoringConfig: Record<string, unknown>;
}

/** The copy a `matches` row embeds (`BOUT_RULES`). */
export function boutRulesOf(match: Record<string, unknown>): BoutRules {
  const copy = asRow(match['match_rules']);
  if (!copy) throw new Error(`Bout ${String(match['id'])} holds no copy of its rules`);
  return {
    rulesetConfig: asRow(copy['ruleset_config']) ?? {},
    scoringConfig: asRow(copy['scoring_config_json']) ?? {},
  };
}

/**
 * The engine the bout's copy names (0232: the copy is the only place a bout's engine lives): the
 * pair the scorer decides with and the pad is told to decide with, one reader for both.
 *
 * The version as the row builder writes it (0229: "1" and "1.0" are 1.0.0): a copy restored from
 * an archive is inserted as the archive holds it, and may say "1".
 */
export function boutEngineOf(match: Record<string, unknown>): { code: string; version: string } {
  const copy = asRow(match['match_rules']);
  if (!copy) throw new Error(`Bout ${String(match['id'])} holds no copy of its rules`);
  const code = copy['ruleset_code'];
  if (typeof code !== 'string' || code.length === 0) {
    throw new Error(`Bout ${String(match['id'])}'s copy names no engine`);
  }
  return { code, version: normalizeRulesetVersion(String(copy['ruleset_version'])) };
}

/** The embed of a `matches` read that carries the card rules the bout's copy pins. */
export const BOUT_CARD_PIN = 'match_rules(penalty_ruleset_id)';

/**
 * The card ruleset the bout's copy pins (`BOUT_CARD_PIN`), resolved Tournament → Event → built-in
 * when the copy was made. Null reads as the built-in: the copy names none, or a delete set its
 * pin NULL. Its `penalty_ruleset_version` is not read: it is stale once the pin is gone.
 */
export function cardPinOf(match: Record<string, unknown>): string | null {
  const copy = asRow(match['match_rules']);
  if (!copy) throw new Error(`Bout ${String(match['id'])} holds no copy of its rules`);
  const pin = copy['penalty_ruleset_id'];
  return typeof pin === 'string' ? pin : null;
}

/** How the copy scores an afterblow: `full` unless it says `deductive` (`afterblowModeInForce`). */
export function afterblowModeOf(rules: BoutRules): 'full' | 'deductive' {
  return afterblowModeInForce(rules.scoringConfig);
}
