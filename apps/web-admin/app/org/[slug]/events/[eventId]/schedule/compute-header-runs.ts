/**
 * Per-run header grouping for the schedule grid: contiguous same-key
 * clusters of scheduled matches, one header band per run.
 *
 * Per lice, matches sort by start and fold left-to-right: a run continues
 * only while the next match shares the run's key (pool id, or
 * tournament|round-token for brackets) AND starts less than one row
 * (5 minutes) after the run's real end, or its Pool's rest after it (at least
 * the rest, less than the rest and a row). Any other gap, a different-key
 * match in between, or a different lice closes the run — so when the operator
 * separates matches, each cluster keeps its own header (and the header's
 * drag/clear scopes to just that cluster).
 *
 * The gap is measured from each bout's exact start and real length, and the
 * header is still drawn in rows. Measured in drawn rows, a Pool of 8-minute
 * bouts broke into several headers: each bout draws on one row, its last three
 * minutes fall between rows, and the next bout starts on a row the run had not
 * reached. The row of slack covers the sheet's gap between bouts
 * (`matchGapSeconds`, 10 s by default), which the server lays after every bout,
 * the rest's included (`lay-run.ts`). The board does not read that gap: a sheet
 * gap of five minutes or more splits the Pool at every bout, as the drawn rows
 * did. For bouts that start and end on row lines it is exactly the old rule.
 *
 * The rest is the crew's pause the server lays in the middle of a Pool
 * (`poolRestMinutes`, operator rulings 1–2). It belongs to the Pool, so the
 * Pool keeps one header across it, and the run reports it so the grid draws it
 * rather than leaving the rows blank (operator ruling, 2026-09-19). Only a gap
 * the length of the rest is one: a shorter gap the operator made still splits
 * the run. The rest is today's sheet's, so a Pool laid before the sheet's rest
 * changed splits at its old rest.
 *
 * Pure: no React, no DOM.
 */

import { SLOT_MINUTES } from '@myclash/schedule-core';

export interface HeaderRunItem {
  id: string;
  key: string;
  liceIndex: number;
  /** The row the match is drawn from, and how many rows it is drawn over. */
  slot: number;
  span: number;
  /** Its exact start and real length, in minutes on the axis. */
  atMinutes: number;
  lengthMinutes: number;
  /** Its Pool's mid-Pool rest in minutes; 0 outside a Pool. */
  restMinutes: number;
}

/** A pause inside a run: the rows it leaves empty, and how long it really is. */
export interface HeaderRunRest {
  startSlot: number;
  /** Exclusive. */
  endSlot: number;
  minutes: number;
}

export interface HeaderRun {
  key: string;
  liceIndex: number;
  startSlot: number;
  /** Exclusive end (last match's slot + span). */
  endSlot: number;
  matchIds: string[];
  rests: HeaderRunRest[];
}

export function computeHeaderRuns(items: HeaderRunItem[]): HeaderRun[] {
  const sorted = [...items].sort((a, b) =>
    a.liceIndex !== b.liceIndex ? a.liceIndex - b.liceIndex : a.atMinutes - b.atMinutes,
  );

  const runs: HeaderRun[] = [];
  // Where the open run ends, in minutes.
  let endMinutes = Number.NEGATIVE_INFINITY;
  for (const it of sorted) {
    const last = runs[runs.length - 1];
    const itemEnd = it.slot + Math.max(1, it.span);
    const itemEndMinutes = it.atMinutes + it.lengthMinutes;
    const gap = it.atMinutes - endMinutes;
    const joins =
      gap < SLOT_MINUTES || (gap >= it.restMinutes && gap < it.restMinutes + SLOT_MINUTES);
    if (last && last.key === it.key && last.liceIndex === it.liceIndex && joins) {
      // A whole row or more of nothing inside the run is its rest.
      if (gap >= SLOT_MINUTES && it.slot > last.endSlot) {
        last.rests.push({ startSlot: last.endSlot, endSlot: it.slot, minutes: Math.round(gap) });
      }
      last.matchIds.push(it.id);
      if (itemEnd > last.endSlot) last.endSlot = itemEnd;
      endMinutes = Math.max(endMinutes, itemEndMinutes);
      continue;
    }
    runs.push({
      key: it.key,
      liceIndex: it.liceIndex,
      startSlot: it.slot,
      endSlot: itemEnd,
      matchIds: [it.id],
      rests: [],
    });
    endMinutes = itemEndMinutes;
  }
  return runs;
}
