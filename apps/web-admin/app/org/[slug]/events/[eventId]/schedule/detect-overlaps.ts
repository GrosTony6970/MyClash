/**
 * "Which lice is running two bouts at once?", for the schedule board.
 *
 * ONE OWNER, AT MATCH LEVEL. This file used to answer the question at BLOCK
 * level: it folded each block's matches on a lice into a single
 * `[min start, max end]` and compared those. That was wrong in both directions
 * at once, and the two halves of the fault hid each other.
 *
 *   It MISSED the commonest case. `buildScheduleBlocks` keys a block on
 *   `pool:${poolId}` and deliberately leaves the lice out, so one pool is one
 *   block however many strips it spans — and a block cannot overlap itself.
 *   `programme/generate` fans a pool across every lice in parallel, so pinning
 *   that pool to one strip lands four bouts at 10:00 on top of each other. One
 *   block. Nothing reported. That is exactly what `setPoolLice` does, and what
 *   07-populate-event does to eight pools.
 *
 *   It INVENTED one that was not there. Two pools taking turns on a strip (A at
 *   10:00 and 10:20, B at 10:10) have overlapping folded intervals and no two
 *   bouts that collide. A legitimate schedule, reported as a clash.
 *
 * Comparing real bouts fixes both, and then there is only one question and one
 * answer to it: the banner names the stacks and the block tint is derived from
 * the same stacks. Two owners of one question is what let a banner that missed
 * real clashes sit beside a tint that invented them.
 *
 * HALF-OPEN INTERVALS. `[start, start + duration)`, so a bout that ends exactly
 * as the next begins does not collide — back-to-back on one strip is the normal
 * case, not a fault. Matches `lice-occupancy.ts` on the server and
 * `conflict-detection.ts` beside this, and it has to: the banner and the 409
 * must not disagree about what an overlap is.
 *
 * Pure: no React, no I/O.
 */
import { SLOT_MINUTES } from '@myclash/schedule-core';
import { hhmmInZone } from './conflict-detection';

/** A prospective placement in slot units — what a drag would land on. */
export interface SlotPlacement {
  liceIds: string[];
  startSlot: number;
  endSlot: number;
}

/**
 * Would dropping `placement` clash with any `occupants`? True when they share a
 * lice AND their [startSlot, endSlot) ranges intersect (touching = no clash).
 * Drives the live red tint on the drag ghost. The caller excludes the block
 * being moved from `occupants` so a same-spot drop doesn't read as a conflict.
 */
export function wouldOverlap(placement: SlotPlacement, occupants: SlotPlacement[]): boolean {
  const lices = new Set(placement.liceIds);
  return occupants.some(
    (o) =>
      o.liceIds.some((l) => lices.has(l)) &&
      placement.startSlot < o.endSlot &&
      o.startSlot < placement.endSlot,
  );
}

/** What the stack detector needs to know about a bout on the board. */
export interface LiceStackMatch {
  id: string;
  /** Falls back to one slot when absent, as the block detector did. */
  durationMinutes?: number;
  liceId: string | null;
  scheduledAt: string | null;
  status: string;
  roundCode?: string;
  matchNumberLabel: string;
}

/** One strip running more than one bout at one moment. */
export interface LiceStack {
  liceId: string;
  /** Resolved by the caller — a lice id must never reach the operator. */
  liceName: string;
  /** `HH:MM` on the event clock, at the earliest bout in the stack. */
  time: string;
  matchIds: string[];
  /** `roundCode || matchNumberLabel` — the code each card shows. */
  matchLabels: string[];
}

interface Interval {
  id: string;
  label: string;
  start: number;
  end: number;
  iso: string;
}

/**
 * Every stack of overlapping bouts, one row per stack rather than one per
 * colliding pair.
 *
 * The demo event has roughly three hundred colliding pairs and about fifty
 * stacks, so pairs would be a wall of text nobody reads. A stack is a maximal
 * run of bouts that chain: A overlaps B and B overlaps C puts all three in one
 * row even if A and C do not touch. Every bout named genuinely overlaps at
 * least one other, so nothing is named innocently.
 *
 * `unknownLiceLabel` and the name map are arguments rather than lookups because
 * this module must not carry English of its own — the same reason
 * `detectConflicts` takes `unknownFighterLabel`. The i18n lint cannot reach a
 * non-JSX module.
 */
export function detectLiceStacks(
  matches: readonly LiceStackMatch[],
  tz: string,
  liceNameById: ReadonlyMap<string, string>,
  unknownLiceLabel: string,
): LiceStack[] {
  const byLice = new Map<string, Interval[]>();
  for (const m of matches) {
    // A bout occupies a strip only when it names both a strip and a time, and a
    // voided bout is not happening at all. Both rules are the server's, from
    // `lice-occupancy.ts` and the occupancy query beside it.
    if (!m.liceId || !m.scheduledAt || m.status === 'voided') continue;
    const start = new Date(m.scheduledAt).getTime();
    // An unreadable timestamp is dropped rather than treated as epoch zero,
    // which would collide with everything on the strip.
    if (Number.isNaN(start)) continue;
    const minutes = m.durationMinutes ?? SLOT_MINUTES;
    const list = byLice.get(m.liceId) ?? [];
    list.push({
      id: m.id,
      label: m.roundCode || m.matchNumberLabel,
      start,
      end: start + minutes * 60_000,
      iso: m.scheduledAt,
    });
    byLice.set(m.liceId, list);
  }

  const stacks: LiceStack[] = [];
  for (const [liceId, intervals] of byLice) {
    intervals.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    let run: Interval[] = [];
    let runEnd = -Infinity;
    const flush = () => {
      if (run.length > 1) {
        stacks.push({
          liceId,
          liceName: liceNameById.get(liceId) ?? unknownLiceLabel,
          time: hhmmInZone(run[0]!.iso, tz),
          matchIds: run.map((i) => i.id),
          matchLabels: run.map((i) => i.label),
        });
      }
      run = [];
    };

    for (const interval of intervals) {
      // Sorted by start, so `start >= runEnd` means this bout begins at or
      // after everything before it has finished — half-open, touching is not
      // overlapping, and the run is closed.
      if (run.length > 0 && interval.start >= runEnd) flush();
      run.push(interval);
      runEnd = Math.max(runEnd, interval.end);
    }
    flush();
  }

  return stacks;
}
