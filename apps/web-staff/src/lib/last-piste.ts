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
 *
 * With no network that list cannot be read: the piste is opened unchecked
 * (`pisteWithNoNetwork`), from the copy the tablet keeps of it. So the piste
 * belongs to ONE person: the tablet keeps who it last saw signed in, and
 * forgets the piste the moment it sees another (`signedInAs`).
 */

const STORAGE_KEY = 'myclash.staff.lastPiste.v1';
const HOLDER_KEY = 'myclash.staff.pisteHolder.v1';

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

/**
 * Where the tablet goes when the app is opened with no network (operator,
 * 2026-10-13): the piste it last opened, from the copy it keeps of it.
 *
 * Not checked against the pistes of the sign-in, as `pisteToOpen` does: the
 * server cannot be asked. The piste's own page asks it when the network is
 * back, and a session that has ended goes to sign-in there. A tablet that
 * remembers no piste (signed out, another person signed in since, or never
 * used) gets the sign-in screen.
 */
export function pisteWithNoNetwork(remembered: string | null): string {
  return remembered === null ? '/login' : `/lices/${remembered}`;
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

/**
 * Who the server says is signed in, as one word the tablet can keep, or null
 * when the answers name nobody.
 *
 * `staff` is the body of `staff-auth/me` or of the PIN sign-in, `me` the body
 * of `/api/v1/me`. The PIN account is asked first, as the pad's door does
 * (`resolveStaffSession`).
 */
export function pisteHolder(
  staff: { account?: { id?: string } } | null,
  me: { user?: { id?: string } } | null,
): string | null {
  if (staff?.account?.id) return `pin:${staff.account.id}`;
  if (me?.user?.id) return `account:${me.user.id}`;
  return null;
}

/** A read of "who is signed in", as `apiRequest` answers it. */
type Read<T> = { ok: true; data: T } | { ok: false; kind: string };

/**
 * `pisteHolder` of the two reads the list of pistes makes: the PIN account,
 * then the MyClash account, which is asked only when no PIN session answered.
 *
 * The MyClash account counts only when the server SAID there is no PIN session
 * (a 401 or a 403). A PIN read that failed any other way proves nothing: on a
 * tablet with both sessions, one server fault would read as another person,
 * and Anna would lose her piste. The race is the same one: the network coming
 * back between the two reads.
 */
export function holderFromReads(
  staff: Read<{ account?: { id?: string } }>,
  me: Read<{ user?: { id?: string } }> | null,
): string | null {
  if (staff.ok) return pisteHolder(staff.data, null);
  if (staff.kind !== 'unauthenticated' || !me?.ok) return null;
  return pisteHolder(null, me.data);
}

/**
 * The tablet saw who is signed in (operator, 2026-10-13).
 *
 * Anna works piste 3 and goes home without "Log out". Ben signs in on that
 * tablet with a desk account. Later Ben opens the app with no wifi: he landed
 * on Anna's piste. Now the piste is forgotten when the tablet sees another
 * person than the one it last saw, so with no wifi Ben gets the sign-in screen.
 *
 * Called where the server answers who is signed in: the list of pistes, and
 * the PIN sign-in. With no network nobody can be asked, and nothing is called:
 * the piste stays with the person the tablet last saw.
 *
 * A tablet that kept a piste and no person (from before this rule) forgets the
 * piste once. An answer that names nobody changes nothing.
 *
 * NOT covered: an organiser who signs in by email link on a tablet that still
 * holds another person's PIN session. The pad asks the PIN session first, so
 * the tablet still sees the PIN account, with a network as without.
 */
export function signedInAs(holder: string | null): void {
  if (holder === null) return;
  try {
    if (window.localStorage.getItem(HOLDER_KEY) === holder) return;
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.setItem(HOLDER_KEY, holder);
  } catch {
    // Private browsing, or a full quota: `rememberedPiste` reads nothing there either.
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
