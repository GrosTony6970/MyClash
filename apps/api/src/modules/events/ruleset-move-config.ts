/**
 * The settings a Tournament holds after its ruleset pair moves: the one owner
 * for the PATCH that swaps the pair before any result, the audited re-pin and
 * its preview.
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
 */
import { deepMergeJson } from '../../common/deep-merge';

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

export function settingsAfterMove(move: RulesetMove): Record<string, unknown> {
  const keeps = move.builtIn && move.fromCode === move.toCode;
  const start = keeps ? deepMergeJson(move.defaults, move.stored) : move.defaults;
  return deepMergeJson(start, move.patch) as Record<string, unknown>;
}
