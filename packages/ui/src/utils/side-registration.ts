/**
 * Is this row (a card, a protest) of this side's Fighter? A side's Registration is null while
 * the side waits for a Fighter, or while it is a team's: null is nobody, so it matches no row,
 * a row with no Registration included. A bare `===` read `null === null` as "this side".
 */
export function isSideRegistration(
  rowRegistrationId: string | null | undefined,
  sideRegistrationId: string | null,
): boolean {
  return sideRegistrationId !== null && rowRegistrationId === sideRegistrationId;
}
