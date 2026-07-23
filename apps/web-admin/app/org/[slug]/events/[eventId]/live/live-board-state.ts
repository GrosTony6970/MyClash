import type { BoardRow } from './types';

export type HealthState =
  | 'attention'
  | 'no_scorer'
  | 'stuck'
  | 'stale'
  | 'unknown'
  | 'synced'
  | 'idle';

export interface Thresholds {
  staleAgeSec: number;
  stuckAgeSec: number;
}
export const DEFAULT_THRESHOLDS: Thresholds = { staleAgeSec: 60, stuckAgeSec: 300 };

/**
 * Collapse a row's scorer/health/attention into a single rollup for the left
 * dot. Ordering encodes precedence: an explicit attention flag outranks any
 * sync state, and a null health block is UNKNOWN (grey), never "synced" — a
 * false green is the one failure that defeats the board.
 */
export function deriveHealthState(row: BoardRow, t: Thresholds = DEFAULT_THRESHOLDS): HealthState {
  if (row.attention) return 'attention';
  if (!row.scorer) return 'no_scorer';
  if (!row.currentMatch) return 'idle';
  if (row.health === null) return 'unknown';
  const h = row.health;
  if (h.rejectedCount > 0 || h.oldestPendingAgeSec > t.stuckAgeSec) return 'stuck';
  if (h.outboxDepth > 0 && h.oldestPendingAgeSec > t.staleAgeSec) return 'stale';
  return 'synced';
}

// worst-first severity (lower = more urgent). no_scorer sits low: a setup gap,
// not a live failure.
const SEVERITY: Record<HealthState, number> = {
  attention: 0,
  stuck: 1,
  stale: 2,
  unknown: 3,
  synced: 4,
  idle: 5,
  no_scorer: 6,
};

export function sortBoardRows(rows: BoardRow[], mode: 'piste' | 'worst'): BoardRow[] {
  const copy = rows.slice();
  if (mode === 'piste') {
    return copy.sort(
      (a, b) => a.lice.sortOrder - b.lice.sortOrder || a.lice.name.localeCompare(b.lice.name),
    );
  }
  return copy.sort((a, b) => {
    const d = SEVERITY[deriveHealthState(a)] - SEVERITY[deriveHealthState(b)];
    return d !== 0 ? d : a.lice.sortOrder - b.lice.sortOrder;
  });
}
