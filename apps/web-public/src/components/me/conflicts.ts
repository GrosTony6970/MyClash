// Time-overlap conflict detection shared by the Schedule view and the
// Workshops tab. Two windows conflict when they overlap at all; matches/
// referee slots have no stored duration so we use the project's 5-minute
// default (same as the scheduler's hardcoded match length).

export const DEFAULT_DURATION_MS = 5 * 60_000;

export interface TimedItem {
  key: string;
  label: string;
  start: number;
  end: number;
}

/** Half-open interval overlap. */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Map of item key → labels of the items it conflicts with (bidirectional). */
export function detectConflicts(items: TimedItem[]): Map<string, string[]> {
  const conflicts = new Map<string, string[]>();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (!a || !b) continue;
      if (overlaps(a.start, a.end, b.start, b.end)) {
        conflicts.set(a.key, [...(conflicts.get(a.key) ?? []), b.label]);
        conflicts.set(b.key, [...(conflicts.get(b.key) ?? []), a.label]);
      }
    }
  }
  return conflicts;
}

/** Build a TimedItem from a start ISO (+ optional end ISO, default +5min). */
export function toTimed(
  key: string,
  label: string,
  startIso: string | null,
  endIso?: string | null,
): TimedItem | null {
  if (!startIso) return null;
  const start = new Date(startIso).getTime();
  if (Number.isNaN(start)) return null;
  const end = endIso ? new Date(endIso).getTime() : start + DEFAULT_DURATION_MS;
  return { key, label, start, end };
}
