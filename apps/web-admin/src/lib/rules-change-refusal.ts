import { failureCode, type ApiFailure } from '@myclash/api-client';
import { RULES_CHANGE_CODES, type RulesChange, type RulesChangeCode } from '@myclash/types';

/**
 * What the API answers a change to a Tournament's scoring rules, in the reader's language.
 *
 * The API refuses a rules change with one of the codes of `RULES_CHANGE_CODES` (`@myclash/types`),
 * and its own sentence is English. Each code is worded here once, as a whole key literal (the
 * i18n reverse sweep must find every key). The record is keyed by the code type, so a code added
 * to `RULES_CHANGE_CODES` without words here does not compile.
 */
const REFUSAL_KEY: Record<RulesChangeCode, string> = {
  [RULES_CHANGE_CODES.needsAudit]: 'admin.rulesChange.refusal.needsAudit',
  [RULES_CHANGE_CODES.closed]: 'admin.rulesChange.refusal.closed',
  [RULES_CHANGE_CODES.changedSinceRead]: 'admin.rulesChange.refusal.changedSinceRead',
  [RULES_CHANGE_CODES.confirmMismatch]: 'admin.rulesChange.refusal.confirmMismatch',
  [RULES_CHANGE_CODES.unchanged]: 'admin.rulesChange.refusal.unchanged',
  [RULES_CHANGE_CODES.mixed]: 'admin.rulesChange.refusal.mixed',
  [RULES_CHANGE_CODES.checkUnavailable]: 'admin.rulesChange.refusal.checkUnavailable',
  [RULES_CHANGE_CODES.cardLocked]: 'admin.rulesChange.refusal.cardLocked',
};

/**
 * `rules_change_closed` says what closed the rules (`details.closedBy`, ruling 148): the
 * Tournament itself, or its Event. Static words: the refusal is worded with no values.
 */
const CLOSED_BY_EVENT_KEY = 'admin.rulesChange.refusal.closedByEvent';

/**
 * `forfeit_rules_invalid` (409) says what cannot be read (`details.cause`): the Tournament's own
 * change, which a Reset repairs, or its penalty ruleset's rules. The Basics block's own two
 * sentences: one owner of those words.
 */
const FORFEIT_INVALID = 'forfeit_rules_invalid';
const FORFEIT_INVALID_KEY = {
  changes: 'admin.orgTournaments.forfeitRulesInvalid',
  ruleset: 'admin.orgTournaments.forfeitRulesetInvalid',
} as const;

const detailsOf = (failure: ApiFailure) =>
  'details' in failure ? (failure.details ?? undefined) : undefined;

/** The words of a rules-change refusal, or null when the failure carries no such code. */
export function rulesChangeRefusal(failure: ApiFailure, t: (key: string) => string): string | null {
  const code = failureCode(failure);
  const details = detailsOf(failure);
  if (code === FORFEIT_INVALID) {
    return t(
      details?.['cause'] === 'ruleset' ? FORFEIT_INVALID_KEY.ruleset : FORFEIT_INVALID_KEY.changes,
    );
  }
  if (code === null || !Object.hasOwn(REFUSAL_KEY, code)) return null;
  if (code === RULES_CHANGE_CODES.closed && details?.['closedBy'] === 'event') {
    return t(CLOSED_BY_EVENT_KEY);
  }
  return t(REFUSAL_KEY[code as RulesChangeCode]);
}

/** A Fighter whose status the refused change moves (the lock's 403, ruling 143). */
export interface MovedFighter {
  registrationId: string;
  name: string;
  before: string;
  after: string;
}

/** What the lock's 403 lists: every change of the save, and the Fighters a forfeit change moves. */
export interface NeedsAudit {
  changes: RulesChange[];
  fighters: MovedFighter[];
}

/**
 * The lock's refusal (`rules_change_needs_audit`): the change goes through the dialog, so its
 * lists are what the dialog shows. Null for any other failure.
 */
export function needsAuditOf(failure: ApiFailure): NeedsAudit | null {
  if (failureCode(failure) !== RULES_CHANGE_CODES.needsAudit) return null;
  const details = detailsOf(failure);
  return {
    changes: (details?.['changes'] as RulesChange[] | undefined) ?? [],
    fighters: (details?.['fighters'] as MovedFighter[] | undefined) ?? [],
  };
}
