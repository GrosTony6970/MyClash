/**
 * Ruleset kind predicate, in a dependency-free module so RulesetForm,
 * ruleset-form-initial and the pages can share it without an import cycle.
 *
 * A ruleset whose maths is CODE — TF_v1 itself, or a `base_code` fork of it
 * ("Customise this format") — has no authored score formula: the form shows the
 * coded internals (winBonus, targets) and reads/writes them through `tf_config`.
 * The predicate's one owner is `@myclash/types/effective-rules` (a subpath,
 * so it stays off every page's bundle), which the API's `effectiveRules`
 * reads too.
 */
import { isCodedRuleset } from '@myclash/types/effective-rules';

export { isCodedRuleset };

/**
 * Which editor a ruleset opens in. `'tf'`: TF_v1 or a copy of it. `'pointsCap'`: the built-in
 * Points cap, whose scoring is code and whose only setting of its own is the match format it
 * keeps in `tf_config` (operator ruling 139). `'formula'`: a club's own formula ruleset.
 */
export type RulesetEditorKind = 'tf' | 'pointsCap' | 'formula';

export function rulesetEditorKind(
  code: string | null | undefined,
  baseCode?: string | null,
): RulesetEditorKind {
  if (isCodedRuleset(code, baseCode)) return 'tf';
  if (code === 'Generic_PointsCap') return 'pointsCap';
  return 'formula';
}

/** What the editor of each kind lets the author change. */
export interface EditorSections {
  /** The authored score formula, its constants, tie-breakers and double penalty. */
  formula: boolean;
  /** TF v1's win bonus and double penalty. */
  dials: boolean;
  /** The targets (Points cap's single hit is its code: shown read-only). */
  targets: boolean;
  /** The afterblow (a coded engine's is its code: shown read-only). */
  afterblow: boolean;
  /** The match format's doubles ceiling (Points cap has none: not shown). */
  maxDoubles: boolean;
}

export const EDITOR_SECTIONS: Record<RulesetEditorKind, EditorSections> = {
  tf: { formula: false, dials: true, targets: true, afterblow: false, maxDoubles: true },
  pointsCap: { formula: false, dials: false, targets: false, afterblow: false, maxDoubles: false },
  formula: { formula: true, dials: false, targets: true, afterblow: true, maxDoubles: true },
};
