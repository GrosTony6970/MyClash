/**
 * The forfeit side of a Tournament's settings save under the lock (the audited settings change,
 * revisions 13-16 of its plan; operator rulings 142, 143, 147).
 *
 * The save's forfeit changes are compared as the rules IN FORCE, before and after
 * (`forfeitRulesChanges`), over the one card-rules row the Tournament plays under now: a save under
 * the lock cannot move the pin (it is refused `card_change_locked` first, ruling 35), so both sides
 * read the same row. Each entry locks on the Tournament's clock, as the card pin does (ruling 73).
 *
 * Two sides may not parse (a hand-edited archive, a broken penalty ruleset):
 * - the side AFTER the save: refused 409 `forfeit_rules_invalid`, nothing written, its `cause`
 *   naming the penalty ruleset or the Tournament's own change it keeps;
 * - the side BEFORE: the save is a repair. It lists one `forfeitRules.unknown` entry, a path with no
 *   value (no raw stored object reaches the record), and the Fighters follow under the rules after
 *   alone: whoever is out of step with them is settled.
 */
import { ConflictException } from '@nestjs/common';
import { forfeitRulesChanges, stableStringify } from '@myclash/rulesets';
import { FORFEIT_UNKNOWN_PATH, type RulesChange } from '@myclash/types';
import type { ForfeitChanges } from '@myclash/types/forfeit-rules';
import { settleRules } from '../matches/fighter-status.service';
import type { StatusRules } from '../matches/follow-rules-change';
import { FORFEIT_RULES_INVALID, forfeitRulesAnswer } from '../penalties/forfeit-rules-in-force';

type Row = Record<string, unknown>;

/** What the forfeit side of a save holds for the lock, the preview and the follow. */
export interface ForfeitSide {
  changes: RulesChange[];
  /** The rules a settle reads, each side; `before` is `after` when the before side did not parse. */
  before: StatusRules;
  after: StatusRules;
  /** The rules before did not parse: the Fighters to name are the ones out of step. */
  beforeUnparsable: boolean;
  /** Whether the Fighters follow: what a settle reads moves, or the save is a repair. */
  follows: boolean;
}

/** The refusal of a save whose rules after do not parse, by what is broken. */
function invalidAfter(cause: 'ruleset' | 'changes'): ConflictException {
  return new ConflictException({
    code: FORFEIT_RULES_INVALID,
    cause,
    message:
      cause === 'ruleset'
        ? 'The forfeit rules of this tournament’s penalty ruleset cannot be read: fix the ruleset.'
        : 'A forfeit rule this tournament changed cannot be read: Reset it on the forfeit rules.',
  });
}

/** The forfeit side of a save from the stored changes `stored` to `next`, over `cardRules`. */
export function forfeitSideOf(
  cardRules: Row,
  stored: ForfeitChanges | null,
  next: ForfeitChanges | null,
): ForfeitSide {
  const after = forfeitRulesAnswer(cardRules, next);
  if (!after.ruleset) throw invalidAfter('ruleset');
  if (!after.inForce) throw invalidAfter('changes');
  const rulesAfter = settleRules(after.inForce);
  const before = forfeitRulesAnswer(cardRules, stored).inForce;
  if (!before) {
    return {
      changes: [{ path: FORFEIT_UNKNOWN_PATH, before: null, after: null }],
      before: rulesAfter,
      after: rulesAfter,
      beforeUnparsable: true,
      follows: true,
    };
  }
  const rulesBefore = settleRules(before);
  return {
    changes: forfeitRulesChanges(before, after.inForce, stored, next),
    before: rulesBefore,
    after: rulesAfter,
    beforeUnparsable: false,
    follows: stableStringify(rulesBefore) !== stableStringify(rulesAfter),
  };
}
