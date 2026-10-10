/**
 * The API's refusals of a hit or a press that are about the PERSON who sends
 * it, not about one bout (rulings 244, 245): they meet every hit the tablet
 * holds, so the drain stops at the first one and the bar says which it is.
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

export function callerRefusalOf(code: string | null | undefined): CallerRefusal | undefined {
  return code == null ? undefined : BY_CODE.get(code);
}

let listener: ((caller: CallerRefusal) => void) | undefined;

/**
 * A press sent at once (a Reopen or a Reset of the clock, a correction, a
 * forfeit) is refused for who sends it too, and nothing of it is queued. The
 * sync engine listens here, so the bar says the cause with its ways out, as for a queued hit (ruling 311).
 * One listener: the pad builds one engine, on the bout screen.
 */
export function hearCallerRefusals(heard: (caller: CallerRefusal) => void): void {
  listener = heard;
}

/** Told by `refusalMessage`, where every refused press of the pad is worded. */
export function tellCallerRefusal(code: string | null): void {
  const caller = callerRefusalOf(code);
  if (caller) listener?.(caller);
}

let sessionEnded: (() => void) | undefined;

/**
 * A press sent at once and answered "nobody is signed in" (ruling 342). The
 * bout screen listens and leaves for the sign-in screen. One listener, the
 * newest: the stop it hands back silences that screen alone, so an older
 * screen that leaves late does not silence the one that replaced it.
 */
export function hearSessionEnded(heard: () => void): () => void {
  sessionEnded = heard;
  return () => {
    if (sessionEnded === heard) sessionEnded = undefined;
  };
}

/** Told by `refusalMessage`, as `tellCallerRefusal` is. */
export function tellSessionEnded(): void {
  sessionEnded?.();
}
