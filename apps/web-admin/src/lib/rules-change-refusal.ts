import { failureCode, type ApiFailure } from '@myclash/api-client';
import { RULES_CHANGE_CODES, type RulesChangeCode } from '@myclash/types';

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

/** The words of a rules-change refusal, or null when the failure carries no such code. */
export function rulesChangeRefusal(failure: ApiFailure, t: (key: string) => string): string | null {
  const code = failureCode(failure);
  return code !== null && Object.hasOwn(REFUSAL_KEY, code)
    ? t(REFUSAL_KEY[code as RulesChangeCode])
    : null;
}
