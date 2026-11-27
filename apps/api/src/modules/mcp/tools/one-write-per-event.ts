/**
 * One MCP referee write at a time per Event, inside this API process (ARCHITECTURE §28.5c).
 *
 * The race it closes: two applies of one Event run at once. Each judges its referee before the
 * other's write lands, so each passes the checker, and one referee can end up on two Matches that
 * overlap (hard rule 8). Run each apply's recheck and write through here, keyed by the Event id:
 * the next caller for the same Event starts only once the previous one settled, fulfilled or
 * rejected. Different Events do not wait for each other.
 *
 * The lock lives in this process only. Production runs one `api` container; a second API process
 * would need a shared lock (a Postgres advisory lock on the Event id).
 */

/** The tail of each Event's chain; an entry is deleted once its chain is empty. */
const tails = new Map<string, Promise<void>>();

export function runOnePerEvent<T>(eventId: string, fn: () => Promise<T>): Promise<T> {
  const before = tails.get(eventId) ?? Promise.resolve();
  const run = before.then(fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(eventId, tail);
  void tail.then(() => {
    if (tails.get(eventId) === tail) tails.delete(eventId);
  });
  return run;
}

/** How many Events have a chain right now: the tests' proof that the map empties. */
export const __testing = { size: (): number => tails.size };
