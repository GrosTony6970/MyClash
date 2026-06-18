/**
 * Whether a roster person's registered email matches the signed-in user's
 * email — the trust rule for auto-suggesting + claiming roster profiles. Both
 * sides are trimmed + lower-cased; an empty/missing email on either side never
 * matches.
 *
 * Pure: no I/O.
 */
export function personEmailMatchesUser(
  personEmail: string | null | undefined,
  userEmail: string | null | undefined,
): boolean {
  const a = (personEmail ?? '').trim().toLowerCase();
  const b = (userEmail ?? '').trim().toLowerCase();
  if (!a || !b) return false;
  return a === b;
}
