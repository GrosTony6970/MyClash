import {
  applyForfeitPatch,
  type ForfeitChanges,
  type ForfeitPatch,
} from '@myclash/types/forfeit-rules';
import { patchOf } from '../../../_shared/patch-of';
import type { StoredForfeit } from '../../../_shared/useForfeitRules';

/** The Basics tab's form. */
export interface TournamentBasics {
  name: string;
  slug: string;
  weapon: string | null;
  rulesetCode: string;
  rulesetVersion: string;
  penaltyRulesetId: string | null;
  /** Slice 4: cap on registered + checked_in. Null = unlimited. */
  maxParticipants: number | null;
  /** Slice 4: cap on waitlist size. Null = unlimited. */
  maxWaitlist: number | null;
  /** The changes of the forfeit rules in the form: a leaf at null is a Reset (ruling 65). */
  forfeitRules: ForfeitPatch | null;
}

/**
 * The Save's body, and what the Tournament stores once it is taken. The forfeit changes are sent
 * only when the form changed them (`patchOf`), so a name-only Save keeps the stored ones.
 */
export function saveBody(
  data: TournamentBasics,
  stored: StoredForfeit | null,
): { body: Record<string, unknown>; stored: StoredForfeit } {
  const forfeitRules = patchOf(stored?.forfeit ?? {}, data.forfeitRules ?? {});
  return {
    body: {
      // Send null (not undefined) so selecting "None" actually clears the
      // weapon — the DTO is nullish and the service maps null to a clear.
      name: data.name,
      weapon: data.weapon,
      // Ruleset is deliberately NOT saved here — a ruleset change is applied
      // through `changeRuleset` so it can fall back to the audited re-pin
      // ceremony, and so an unrelated Save never 403s (and loses these
      // edits) when the tournament already has results.
      penaltyRulesetId: data.penaltyRulesetId,
      maxParticipants: data.maxParticipants,
      maxWaitlist: data.maxWaitlist,
      ...(forfeitRules ? { forfeitRules } : {}),
    },
    stored: {
      pin: data.penaltyRulesetId,
      forfeit: forfeitRules
        ? applyForfeitPatch(stored?.forfeit ?? null, forfeitRules)
        : (stored?.forfeit ?? null),
    },
  };
}

/**
 * The form as saved, after an AUDITED save that left `forfeit` stored: it sent the forfeit rules
 * alone, so only they are marked saved; a name or a cap changed beside stays unsaved, and the next
 * Save sends it (ruling 151). Never `savedAfter`, which marks the whole form.
 */
export const forfeitSavedAfter = (
  saved: TournamentBasics | null,
  forfeit: ForfeitChanges | null,
) => (saved ? { ...saved, forfeitRules: forfeit } : saved);

/**
 * The form as saved, after a Save that sent `sent` and left `forfeit` stored: the ruleset pair is
 * not part of it, and the forfeit changes are the stored ones, a Reset sent no longer a null.
 */
export const savedAfter = (
  saved: TournamentBasics | null,
  sent: TournamentBasics,
  forfeit: ForfeitChanges | null,
) =>
  saved
    ? {
        ...sent,
        forfeitRules: forfeit,
        rulesetCode: saved.rulesetCode,
        rulesetVersion: saved.rulesetVersion,
      }
    : saved;
