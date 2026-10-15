/**
 * The ticks of the roster after a bulk action (ruled 2026-10-15): the people it was refused
 * for stay ticked, so the next press tries them again, and so do the people ticked while it
 * ran. The ones it did are unticked.
 *
 * The race: the action runs on `batch`, the ticks at its press; the organiser can tick more
 * while its writes are out. `now` is the ticks when it ends, read in a state update, so a
 * tick that landed meanwhile is not overwritten.
 */
export function ticksAfterBulk(
  now: ReadonlySet<string>,
  batch: ReadonlySet<string>,
  refused: ReadonlySet<string>,
): Set<string> {
  const next = new Set(refused);
  for (const id of now) if (!batch.has(id)) next.add(id);
  return next;
}
