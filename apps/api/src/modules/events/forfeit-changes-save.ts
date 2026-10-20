import { stableStringify } from '@myclash/rulesets';
import {
  applyForfeitPatch,
  type ForfeitChanges,
  type ForfeitPatch,
} from '@myclash/types/forfeit-rules';

/**
 * A save's changes of a Tournament's forfeit rules (ruling 65): the stored changes after the
 * patch, and whether that is a REAL change. Compared as canonical JSON, so the same changes in
 * another key order, or a Reset of a key the Tournament does not hold, change nothing: the lock
 * refuses only a real change (ruling 73). The compare of the stored changes, not of the rules in
 * force: adding a change equal to the ruleset's value is a change.
 */
export function forfeitChangesOfSave(
  stored: unknown,
  patch: ForfeitPatch | undefined,
): { changed: boolean; next: ForfeitChanges | null } {
  const raw = (stored as ForfeitChanges | null | undefined) ?? null;
  if (patch === undefined) return { changed: false, next: raw };
  // As the API stores them: a restored archive may hold a top-level `{}`, which changes nothing,
  // as NULL does. An empty object deeper down is kept as stored, and reads as a change.
  const before = applyForfeitPatch(raw, {});
  const next = applyForfeitPatch(before, patch);
  return { changed: stableStringify(before) !== stableStringify(next), next };
}
