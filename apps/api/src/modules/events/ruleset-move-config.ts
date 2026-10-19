/**
 * The rules a Tournament holds after its ruleset pair moves: the one owner for
 * the PATCH that swaps the pair before any result, the audited re-pin and its
 * preview.
 *
 * Operator ruling "A version move" (2026-10-17): a Tournament on TF_v1 1.0.0
 * with a cap of 7 that moves to 1.1.0 keeps its cap. A built-in's versions
 * differ in the end decision only and share their settings, so a move between
 * them keeps the stored settings. A club ruleset's version IS its content (a
 * new cap, a new formula), so a move to another of its versions takes that
 * version's settings, as a move to another code always did (ruling "Club
 * version", 2026-10-18). A caller's own patch, sent with the move, goes on top
 * of either. A stored row is fully parsed, so its keys win; the defaults fill
 * only what a stored row lacks (an empty or a legacy row).
 *
 * The buttons follow the same rule (operator ruling "Draft switch",
 * 2026-10-19): a move that takes the new pair's settings also takes its buttons
 * and afterblow mode, seeded as a new Tournament's are; the display (side
 * colours, quick penalties) is the organiser's and stays. A built-in's other
 * version keeps them.
 */
import type { RulesetRegistry } from '@myclash/rulesets';
import type { TournamentScoringConfig } from '@myclash/types';
import type { SupabaseService } from '../supabase/supabase.service';
import { deepMergeJson } from '../../common/deep-merge';
import { scoringKindOf } from '../ruleset-hash/scoring-structure';
import {
  buildSeededScoringConfig,
  isSystemRuleset,
  resolveRulesetConfigDefaults,
  resolveRulesetGrammar,
} from './ruleset-defaults';
import {
  normalizeTournamentScoringConfig,
  validateTournamentRulesetConfig,
  type TournamentRulesetConfig,
} from './tournament-config';

export interface RulesetMove {
  fromCode: string;
  toCode: string;
  /** The target pair is a built-in (in the code registry). */
  builtIn: boolean;
  /** The settings stored on the Tournament before the move (null when none). */
  stored: unknown;
  /** The new pair's settings. */
  defaults: Record<string, unknown>;
  /** Settings the caller sends with the move, if any. */
  patch?: Record<string, unknown>;
}

/** Whether a move keeps what the Tournament stored: a built-in's other version. */
function keepsStored(move: Pick<RulesetMove, 'fromCode' | 'toCode' | 'builtIn'>): boolean {
  return move.builtIn && move.fromCode === move.toCode;
}

export function settingsAfterMove(move: RulesetMove): Record<string, unknown> {
  const start = keepsStored(move) ? deepMergeJson(move.defaults, move.stored) : move.defaults;
  return deepMergeJson(start, move.patch) as Record<string, unknown>;
}

/**
 * The stored scoring config with the buttons and afterblow mode of `seed` (the
 * new pair's, `buildSeededScoringConfig`) and the stored display, normalized as
 * every write stores it.
 */
export function seededScoringOfMove(
  stored: unknown,
  seed: Record<string, unknown>,
): TournamentScoringConfig {
  const own = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  return normalizeTournamentScoringConfig({
    ...own,
    afterblowMode: seed['afterblowMode'],
    buttons: seed['buttons'],
  });
}

/** A move of a Tournament's pair, as a door asks for it. */
export interface MoveRequest {
  fromCode: string;
  toCode: string;
  toVersion: string;
  /** The Tournament's stored `ruleset_config` and `scoring_config_json`, raw. */
  storedSettings: unknown;
  storedScoring: unknown;
  /** Settings the caller sends with the move (the PATCH's `rulesetConfig`). */
  patch?: Record<string, unknown>;
}

/** The rules after a move: validated settings, and the seeded scoring config or null when kept. */
export interface RulesAfterMove {
  rulesetConfig: TournamentRulesetConfig;
  seededScoring: TournamentScoringConfig | null;
}

/**
 * The settings and the scoring config a Tournament holds after `move`. The PATCH
 * switch, the re-pin and its preview all ask it, so the preview lists what the
 * re-pin writes. The target's grammar is read at its version, as the scorer
 * reads it; the seed reads the targets of the pair's kind.
 */
export async function nextOfMove(
  deps: { supabase: SupabaseService; registry: RulesetRegistry },
  move: MoveRequest,
): Promise<RulesAfterMove> {
  const { supabase, registry } = deps;
  const builtIn = isSystemRuleset(registry, move.toCode, move.toVersion);
  const defaults = await resolveRulesetConfigDefaults(supabase, move.toCode, move.toVersion);
  const settings = settingsAfterMove({ ...move, builtIn, stored: move.storedSettings, defaults });
  const rulesetConfig = validateTournamentRulesetConfig(move.toCode, settings);
  if (keepsStored({ ...move, builtIn })) return { rulesetConfig, seededScoring: null };
  const [grammar, kind] = await Promise.all([
    resolveRulesetGrammar(supabase, registry, move.toCode, move.toVersion),
    scoringKindOf(supabase, registry, move.toCode, move.toVersion),
  ]);
  const seed = buildSeededScoringConfig(grammar, rulesetConfig, kind);
  return { rulesetConfig, seededScoring: seededScoringOfMove(move.storedScoring, seed) };
}
