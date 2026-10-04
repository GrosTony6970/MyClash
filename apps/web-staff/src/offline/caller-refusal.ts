/**
 * The API's refusals of a queued hit that are about the PERSON who sends it,
 * not about one bout (rulings 244, 245): they meet every hit the tablet holds,
 * so the drain stops at the first one and the bar says which it is.
 *
 * Known by the `code` of the 403 (`staff/scoring-refusals.ts` in the API). A
 * 403 with any other code is about the bout (another piste, another Event): it
 * is held, and the queue goes on (rulings 242, 245a).
 */
export type CallerRefusal = 'account-refused' | 'pin-disabled' | 'pin-role-refused';

const BY_CODE = new Map<string, CallerRefusal>([
  ['account_cannot_score', 'account-refused'],
  ['staff_account_disabled', 'pin-disabled'],
  ['staff_role_not_allowed', 'pin-role-refused'],
]);

export function callerRefusalOf(code: string | undefined): CallerRefusal | undefined {
  return code === undefined ? undefined : BY_CODE.get(code);
}
