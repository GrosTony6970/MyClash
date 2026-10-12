/**
 * The piste this tablet last opened (quick win P17; operator, 2026-10-12).
 *
 * The tablet of piste 3 is closed at lunch. At 14:00 the app showed the list of
 * pistes again, and the official tapped piste 3 again. Now the app opens the
 * last piste at once, when it is still one of the pistes of this sign-in. A
 * tablet with ONE assigned piste opens it at once too.
 *
 * "At once" is on ARRIVAL only: the app is opened, or somebody signs in. The
 * link "Your Lices" of a piste shows the list and stays there, or the list
 * could never be reached again.
 *
 * `last-event.ts` remembers the Event of the sign-in screen and never submits
 * it. This one acts, and can: the list it is checked against is the list of
 * the person who is signed in NOW, so a tablet that changed hands opens
 * nothing that is not theirs. Sign-out forgets the piste.
 */

const STORAGE_KEY = 'myclash.staff.lastPiste.v1';

/** Where an arrival lands: the list of pistes, told that it is an arrival. */
export const PISTES_ON_ARRIVAL = '/lices?arrive=1';

/** Is this the address of an arrival? `search` is `window.location.search`. */
export function isArrival(search: string): boolean {
  return new URLSearchParams(search).get('arrive') === '1';
}

/**
 * The piste to open at once, or null: show the list.
 *
 * `assigned` is the list the server gave for this sign-in. A remembered piste
 * that is not in it is not opened: another person, another Event, or a piste
 * taken off this account.
 */
export function pisteToOpen(
  arriving: boolean,
  assigned: readonly string[],
  remembered: string | null,
): string | null {
  if (!arriving) return null;
  const [only] = assigned;
  if (assigned.length === 1 && only) return only;
  return remembered !== null && assigned.includes(remembered) ? remembered : null;
}

/** The official opened this piste. Best effort: a tablet that cannot write shows the list next time. */
export function rememberPiste(liceId: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, liceId);
  } catch {
    // Private browsing, or a full quota.
  }
}

/** The piste this tablet last opened, or null. */
export function rememberedPiste(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

/** Somebody signed out: the next person starts from the list. */
export function forgetPiste(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing was kept.
  }
}
