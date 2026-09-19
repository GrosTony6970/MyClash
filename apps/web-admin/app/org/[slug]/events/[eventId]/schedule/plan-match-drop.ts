import { zonedDay } from '@myclash/time';
import { placeWithShift, type PlaceableItem } from './place-with-shift';
import type { MinuteAssignment } from './block-geometry';

/**
 * Where every match ends up when the operator drops one on a cell — the dropped
 * match and every neighbour the cascade displaces.
 *
 * Pure, and in minutes on the axis rather than times: resolving minutes to an
 * instant needs the event timezone, which is the component's business.
 * `placeWithShift` already owns the cascade arithmetic and is tested; this is
 * the layer that decides what to feed it, which is where the interesting
 * mistakes live — the wrong occupant set, the wrong length, or forgetting to
 * exclude the dragged match from its own collision check. The length was wrong
 * once: fed in floored 5-minute slots, an 8-minute bout pushed its neighbour
 * only five minutes on, and the server refused the overlap.
 *
 * The result is deliberately ONE list. The dropped match and its displaced
 * neighbours are a single operation to the operator, so they are saved as one
 * batch the server checks as a whole, and a refusal re-reads the server rather
 * than leaving half a column moved on screen and unmoved in the database.
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
 * True when two times name the same instant, whatever their format.
 *
 * The schedule read serves the database's own text ("…T08:43:00+00:00") and
 * the board writes `toISOString()` ("…T08:43:00.000Z"). Compared as strings,
 * an unmoved bout read as moved, and every group drop re-sent every bout on the
 * piste that day — so an old overlap between two of them refused the drop.
 */
export function sameInstant(a: string | null, b: string): boolean {
  return a !== null && Date.parse(a) === Date.parse(b);
}

/**
 * The matches already sitting on one lice on one day, as placeable items: each
 * at its exact start, as long as its real length, in minutes.
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
  minuteOf: (iso: string) => number;
}): PlaceableItem[] {
  const { matches, liceId, day, tz, excludeId, minuteOf } = args;
  return matches
    .filter(
      (m) =>
        m.id !== excludeId &&
        m.liceId === liceId &&
        m.scheduledAt &&
        matchBelongsToDay(m.scheduledAt, day, tz),
    )
    .map((m) => ({ id: m.id, at: minuteOf(m.scheduledAt!), length: m.durationMinutes }));
}

/**
 * Plan a single-match drop. The dropped match is always first in the result.
 *
 * The caller decides whether the drop is worth making at all. The same-cell
 * no-op test stays there on purpose: it compares the resolved instant rather
 * than the cell — a match sitting at 09:02 dropped onto the 09:00 cell IS
 * re-timed, and a cell comparison would call that a no-op — and it also gates
 * the undo push, which is the component's state.
 */
export function planMatchDrop(args: {
  matches: readonly PlannableMatch[];
  dropped: PlannableMatch;
  targetLiceId: string;
  dropAtMinutes: number;
  day: string;
  /** Event timezone — the clock `day` is measured on. See `matchBelongsToDay`. */
  tz: string;
  gridEndMinutes: number;
  minuteOf: (iso: string) => number;
}): MinuteAssignment[] {
  const { matches, dropped, targetLiceId, dropAtMinutes, day, tz, gridEndMinutes, minuteOf } = args;
  const occupants = occupantsOnLice({
    matches,
    liceId: targetLiceId,
    day,
    tz,
    excludeId: dropped.id,
    minuteOf,
  });
  const placement = placeWithShift({
    items: occupants,
    dropped: { id: dropped.id, at: dropAtMinutes, length: dropped.durationMinutes },
    dropAt: dropAtMinutes,
    gridEnd: gridEndMinutes,
  });
  // Everything the cascade touched stays on the target lice — a displaced
  // neighbour was already there, and the dropped match is arriving: where it
  // landed, which is later than the drop when a bout there is still running.
  const landed = placement.items.find((item) => item.id === dropped.id)!;
  // A neighbour "pushed" by less than a millisecond has not moved, and is not
  // re-sent: the server would check it again, old overlaps and all.
  const wasAt = new Map(occupants.map((o) => [o.id, o.at]));
  const moved = placement.shifted.filter((s) => !sameMillisecond(s.at, wasAt.get(s.id)!));
  return [
    { id: dropped.id, liceId: targetLiceId, atMinutes: landed.at },
    ...moved.map((s) => ({ id: s.id, liceId: targetLiceId, atMinutes: s.at })),
  ];
}

/**
 * True when two positions on the axis, in minutes, name the same millisecond —
 * the one the board saves (`axisMinutesToTime` rounds to it).
 *
 * Minutes are floats. 08:10:20 is 10.333…4 minutes after 08:00, so a bout
 * landing when a 5-minute bout from 08:10:20 ends, 8 minutes long, ends at
 * 23.333…6 — a hair past a neighbour at 08:23:20, which reads 23.333…2. The
 * cascade "pushes" that neighbour to the time it already has.
 */
function sameMillisecond(aMinutes: number, bMinutes: number): boolean {
  return Math.round(aMinutes * 60_000) === Math.round(bMinutes * 60_000);
}
