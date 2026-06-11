/**
 * Per-run header grouping for the schedule grid: contiguous same-key
 * clusters of scheduled matches, one header band per run.
 *
 * Per lice, matches sort by slot and fold left-to-right: a run continues
 * only while the next match shares the run's key (pool id, or
 * tournament|round-token for brackets) AND starts at-or-before the run's
 * current end (back-to-back or overlapping). A time gap, a different-key
 * match in between, or a different lice closes the run — so when the
 * operator separates matches, each cluster keeps its own header (and the
 * header's drag/clear scopes to just that cluster).
 *
 * Pure: no React, no DOM.
 */

export interface HeaderRunItem {
  id: string;
  key: string;
  liceIndex: number;
  slot: number;
  span: number;
}

export interface HeaderRun {
  key: string;
  liceIndex: number;
  startSlot: number;
  /** Exclusive end (last match's slot + span). */
  endSlot: number;
  matchIds: string[];
}

export function computeHeaderRuns(items: HeaderRunItem[]): HeaderRun[] {
  const sorted = [...items].sort((a, b) =>
    a.liceIndex !== b.liceIndex ? a.liceIndex - b.liceIndex : a.slot - b.slot,
  );

  const runs: HeaderRun[] = [];
  for (const it of sorted) {
    const last = runs[runs.length - 1];
    const itemEnd = it.slot + Math.max(1, it.span);
    if (last && last.key === it.key && last.liceIndex === it.liceIndex && it.slot <= last.endSlot) {
      last.matchIds.push(it.id);
      if (itemEnd > last.endSlot) last.endSlot = itemEnd;
      continue;
    }
    runs.push({
      key: it.key,
      liceIndex: it.liceIndex,
      startSlot: it.slot,
      endSlot: itemEnd,
      matchIds: [it.id],
    });
  }
  return runs;
}
