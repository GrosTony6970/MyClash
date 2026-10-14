/**
 * Which Tournament an Event's page shows (quick win O7, ruled 2026-10-14): the one in
 * the address, then the last one picked in THIS Event on this browser, then the first.
 * Pure but for the browser's memory: `useTournamentChoice` is the one caller.
 */

/** "Every Tournament": the roster's first tab, the print pack's joined job. Never remembered. */
export const ALL_TOURNAMENTS = 'all';

/** `choices` in the page's order; the first is the default. '' when there is none. */
export function chooseTournament(
  choices: readonly string[],
  fromAddress: string | null,
  remembered: string | null,
): string {
  if (fromAddress && choices.includes(fromAddress)) return fromAddress;
  if (remembered && choices.includes(remembered)) return remembered;
  return choices[0] ?? '';
}

const keyOf = (eventId: string) => `myclash.tournament.${eventId}`;

/** The last Tournament picked in this Event; null when none, or the browser keeps nothing. */
export function rememberedTournament(eventId: string): string | null {
  try {
    return window.localStorage.getItem(keyOf(eventId));
  } catch {
    return null;
  }
}

/** Remembers the pick. "Every Tournament" is a view of one page, not a Tournament: kept out. */
export function rememberTournament(eventId: string, tournamentId: string): void {
  if (tournamentId === ALL_TOURNAMENTS) return;
  try {
    window.localStorage.setItem(keyOf(eventId), tournamentId);
  } catch {
    // Site data blocked: the address still carries the pick.
  }
}

/**
 * The address `href` with `?tournamentId=`, its other parameters and its hash (a tab) kept.
 * A link drawn before the page knows its Tournament ('') goes out bare.
 */
export function withTournament(href: string, tournamentId: string): string {
  const url = new URL(href, 'http://local');
  if (tournamentId) url.searchParams.set('tournamentId', tournamentId);
  return `${url.pathname}${url.search}${url.hash}`;
}
