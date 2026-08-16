import { zonedDay } from '@myclash/time';
import { placeWithShift } from './place-with-shift';
import { matchSlotSpan, type SlotAssignment } from './block-geometry';

/**
 * Where every match ends up when the operator drops one on a cell — the dropped
 * match and every neighbour the cascade displaces.
 *
 * Pure, and in slots rather than times: resolving a slot to an instant needs the
 * event timezone, which is the component's business. `placeWithShift` already
 * owns the cascade arithmetic and is tested; this is the layer that decides what
 * to feed it, which is where the interesting mistakes live — the wrong occupant
 * set, the wrong span, or forgetting to exclude the dragged match from its own
 * collision check.
 *
 * The result is deliberately ONE list. The dropped match and its displaced
 * neighbours are a single operation to the operator, so they are written as one
 * fan-out and a rejection re-reads the server rather than leaving half a column
 * moved on screen and unmoved in the database.
 */

/** What the planner needs to know about any match on the board. */
export interface PlannableMatch {
  id: string;
  liceId: string | null;
  scheduledAt: string | null;
  durationMinutes: number;
}

/**
 * True when `scheduledAtIso` falls on `dayIso` **on the event's wall clock**.
 *
 * This used to be `scheduledAtIso.slice(0, 10) === dayIso`, which is the UTC
 * day. The two agree for most of a competition day and part company either side
 * of local midnight, and where that lands depends on the offset: east of UTC it
 * is the small hours (a 00:30 bout in Paris is 22:30Z the day before, so it
 * disappeared off day 2 and reappeared at the top of day 1), but WEST of UTC it
 * moves into the working day — at UTC−7 the boundary is 17:00 local, so every
 * afternoon bout filed under tomorrow.
 *
 * `zonedDay` is the repo's answer to this and predates the bug being noticed
 * here: `schedule-csv.ts` and the public schedule already use it, and
 * `block-move-plan.ts` carries a docblock warning against exactly the
 * `toISOString().slice(0, 10)` this replaced. This finishes that migration.
 *
 * `tz` is REQUIRED rather than defaulted, because a default is how the UTC
 * assumption survived: every call site has to name a clock, and `tsc` lists
 * them. Note that no test can defend that — a later session adding
 * `tz = DEFAULT_EVENT_TIMEZONE` reds nothing — so it is stated here instead.
 */
export function matchBelongsToDay(
  scheduledAtIso: string | null,
  dayIso: string,
  tz: string,
): boolean {
  if (!scheduledAtIso) return false;
  return zonedDay(scheduledAtIso, tz) === dayIso;
}

/**
 * The matches already sitting on one lice on one day, as placeable items.
 *
 * `excludeId` drops the match being dragged. Without it a match dropped back
 * onto its own column collides with itself and the cascade shoves the whole
 * column down by one bout.
 */
export function occupantsOnLice(args: {
  matches: readonly PlannableMatch[];
  liceId: string;
  day: string;
  /** Event timezone — the clock `day` is measured on. See `matchBelongsToDay`. */
  tz: string;
  excludeId: string;
  slotOf: (iso: string) => number;
}): Array<{ id: string; slot: number; span: number }> {
  const { matches, liceId, day, tz, excludeId, slotOf } = args;
  return matches
    .filter(
      (m) =>
        m.id !== excludeId &&
        m.liceId === liceId &&
        m.scheduledAt &&
        matchBelongsToDay(m.scheduledAt, day, tz),
    )
    .map((m) => ({
      id: m.id,
      slot: slotOf(m.scheduledAt!),
      span: matchSlotSpan(m.durationMinutes),
    }));
}

/**
 * Plan a single-match drop. The dropped match is always first in the result.
 *
 * The caller decides whether the drop is worth making at all. The same-cell
 * no-op test stays there on purpose: it compares the resolved instant rather
 * than the slot — a match sitting at 09:02 dropped onto the 09:00 slot IS
 * re-timed, and a slot comparison would call that a no-op — and it also gates
 * the undo push, which is the component's state.
 */
export function planMatchDrop(args: {
  matches: readonly PlannableMatch[];
  dropped: PlannableMatch;
  targetLiceId: string;
  slot: number;
  day: string;
  /** Event timezone — the clock `day` is measured on. See `matchBelongsToDay`. */
  tz: string;
  gridEndSlot: number;
  slotOf: (iso: string) => number;
}): SlotAssignment[] {
  const { matches, dropped, targetLiceId, slot, day, tz, gridEndSlot, slotOf } = args;
  const placement = placeWithShift({
    items: occupantsOnLice({
      matches,
      liceId: targetLiceId,
      day,
      tz,
      excludeId: dropped.id,
      slotOf,
    }),
    dropped: { id: dropped.id, slot, span: matchSlotSpan(dropped.durationMinutes) },
    dropSlot: slot,
    gridEndSlot,
  });
  // Everything the cascade touched stays on the target lice — a displaced
  // neighbour was already there, and the dropped match is arriving.
  return [
    { id: dropped.id, liceId: targetLiceId, slot },
    ...placement.shifted.map((s) => ({ id: s.id, liceId: targetLiceId, slot: s.slot })),
  ];
}
