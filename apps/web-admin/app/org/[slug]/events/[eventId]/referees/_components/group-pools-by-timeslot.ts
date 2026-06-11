/**
 * Timeslot grouping shared by the pool timeline and the assignments
 * "by time slot" card grid: pools whose `scheduledStart` falls within
 * 5 minutes of each other land in the same block. Pools sharing an
 * identical `scheduledStart` (the common case for scheduler-generated
 * layouts) always end up together; the tolerance only matters when the
 * operator has hand-edited slot times.
 *
 * Pure: no React, no DOM. Generic so the timeline's TimelinePool and
 * the board's AssignmentBoardPool both flow through unchanged.
 */

const GROUP_WINDOW_MS = 5 * 60 * 1000;

export interface TimeslotBlock<T extends { scheduledStart: string | null }> {
  /** Start time of the block (= the earliest scheduledStart of its pools). */
  startTime: string;
  pools: T[];
}

export function groupPoolsByTimeslot<T extends { scheduledStart: string | null }>(
  pools: T[],
): { blocks: TimeslotBlock<T>[]; unscheduled: T[] } {
  const scheduled = pools
    .filter((p) => p.scheduledStart !== null)
    .sort((a, b) => (a.scheduledStart! < b.scheduledStart! ? -1 : 1));

  const blocks: TimeslotBlock<T>[] = [];
  for (const pool of scheduled) {
    const last = blocks[blocks.length - 1];
    if (last) {
      const lastTime = new Date(last.startTime).getTime();
      const thisTime = new Date(pool.scheduledStart!).getTime();
      if (thisTime - lastTime <= GROUP_WINDOW_MS) {
        last.pools.push(pool);
        continue;
      }
    }
    blocks.push({ startTime: pool.scheduledStart!, pools: [pool] });
  }

  return { blocks, unscheduled: pools.filter((p) => !p.scheduledStart) };
}
