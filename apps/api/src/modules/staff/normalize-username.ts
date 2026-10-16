/**
 * The one owner of a staff username's stored form: trimmed and lower-cased.
 *
 * Two places must agree on it, which is why it is neither the service's private
 * helper nor the throttle's. `StaffService` writes it on create and update and
 * looks the account up with `.eq` on it (ruling 48), and the PIN throttle keys
 * its bucket on it (`common/throttling/throttle-by-staff-account.ts`). If the
 * throttle normalized less than the lookup does, `  ref1  ` would reach the
 * account `ref1` while counting as a bucket of its own — the unbounded-guessing
 * hole ruling 48 closed, reopened from the other side.
 *
 * A leaf on purpose: it imports nothing, so the throttle's interceptor can take
 * it without pulling the staff module in.
 *
 * Takes `unknown` because the interceptor runs before the validation pipe and
 * sees raw input; anything that is not a string is no username at all.
 */
export function normalizeStaffUsername(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
