/**
 * The copy of a person's schedule this phone keeps, so the page still shows it
 * in a hall with no signal (quick win F10; the personal space kept one already).
 *
 * It is one person's day, on a phone that may change hands. So it is REMOVED
 * when that person leaves: at sign-out, when an account is deleted, at "this is
 * not me", when a visitor picks a name or signs in, and when the server says it
 * knows nobody here. Nothing removed
 * it before: after a sign-out the next person saw the old schedule until their
 * own read landed.
 *
 * One copy per Event, under the key its page reads the Event by (the guest page
 * its address, the personal space its id).
 */
const PREFIX = 'myclash:schedule:';

export interface ScheduleCopy<T> {
  schedule: T;
  /** When the server gave it, on this phone's clock (ms). */
  fetchedAt: number;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** The phone's store, or none: on the server, and in a browser that blocks site data (it throws). */
function phoneStore(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function keptSchedule<T>(
  eventKey: string,
  store: Store | null = phoneStore(),
): ScheduleCopy<T> | null {
  try {
    const raw = store?.getItem(`${PREFIX}${eventKey}`);
    if (!raw) return null;
    const copy = JSON.parse(raw) as Partial<ScheduleCopy<T>> | null;
    return copy?.schedule && typeof copy.fetchedAt === 'number' ? (copy as ScheduleCopy<T>) : null;
  } catch {
    return null;
  }
}

export function keepSchedule<T>(
  eventKey: string,
  copy: ScheduleCopy<T>,
  store: Store | null = phoneStore(),
): void {
  try {
    store?.setItem(`${PREFIX}${eventKey}`, JSON.stringify(copy));
  } catch {
    // The store is full or refuses: the page works from the server alone.
  }
}

export function forgetSchedule(eventKey: string, store: Store | null = phoneStore()): void {
  try {
    store?.removeItem(`${PREFIX}${eventKey}`);
  } catch {
    // Nothing was kept.
  }
}

let departures = 0;

/**
 * How many times a person left this phone since the page loaded. A schedule
 * page notes it when it starts to read, and takes no answer once it moved: a
 * read that was out when she left would write her schedule back after
 * `forgetSchedules` removed it.
 */
export function departuresSoFar(): number {
  return departures;
}

/** Every Event's copy: the person on this phone is leaving, or is another one now. */
export function forgetSchedules(store: Store | null = phoneStore()): void {
  departures += 1;
  try {
    if (!store) return;
    const keys = Array.from({ length: store.length }, (_, index) => store.key(index));
    for (const key of keys) {
      if (key?.startsWith(PREFIX)) store.removeItem(key);
    }
  } catch {
    // Nothing was kept.
  }
}
