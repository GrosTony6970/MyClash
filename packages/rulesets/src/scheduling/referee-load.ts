/**
 * referee-load.ts — the two rules about how much one referee does in a day (ADR-019).
 *
 * Both are Discouraged, and `referee-checker.ts` turns what these find into reasons:
 *   - rest: another duty in a day slot within `restSlots` of the target's. A slot is a
 *     distinct start time of the day's Pools and Swiss units, in time order; two Pools
 *     that start at the same minute are one slot, and a lunch between two slots changes
 *     nothing. A bracket bout sits in no slot (ruling 139), nor does anything untimed.
 *   - cap: more distinct bouts under the person's duties that day than `maxBoutsPerDay`.
 *     Two roles on one bout count it once. A duty with no day counts toward no cap.
 *
 * The slot and the day arrive on the target and on each duty, already measured on the
 * Event clock by whoever built them. Pure: no I/O, no clock.
 */
import type { RefereeCommitment, RefereeTarget } from './referee-checker-types';

type Duty = Extract<RefereeCommitment, { kind: 'referee' }>;

/** The duties within `restSlots` slots of the target on its day, other than its own slot. */
export function dutiesTooClose(
  target: RefereeTarget,
  duties: readonly Duty[],
  restSlots: number,
): Duty[] {
  const { slot, dayIndex } = target;
  if (restSlots <= 0 || slot === null || dayIndex === null) return [];
  return duties.filter((d) => {
    if (d.slot === null || d.dayIndex !== dayIndex) return false;
    const gap = Math.abs(d.slot - slot);
    return gap > 0 && gap <= restSlots;
  });
}

/**
 * The distinct bouts one person would referee on `dayIndex`: the duties among `commitments`
 * (pass one person's), plus `extra`. The one count of ADR-019's cap and of the board's load.
 */
export function boutsOnDay(
  commitments: readonly RefereeCommitment[],
  dayIndex: number | null,
  extra: readonly string[] = [],
): number {
  if (dayIndex === null) return 0;
  const bouts = new Set(extra);
  for (const d of commitments) {
    if (d.kind === 'referee' && d.dayIndex === dayIndex) for (const id of d.matchIds) bouts.add(id);
  }
  return bouts.size;
}

/** The day's total with the target taken, when it goes past the cap; null when it does not. */
export function boutsOverCap(
  target: RefereeTarget,
  duties: readonly Duty[],
  maxBoutsPerDay: number,
): number | null {
  if (maxBoutsPerDay <= 0 || target.dayIndex === null) return null;
  const total = boutsOnDay(duties, target.dayIndex, target.matchIds);
  return total > maxBoutsPerDay ? total : null;
}
