'use client';
import { useMemo } from 'react';
import { deriveHealthState, type HealthState } from './live-board-state';
import type { BoardRow } from './types';

/**
 * One health state per row per tick, as a lookup.
 *
 * Both the board and the wall need this and must not disagree. Deriving it
 * once per row also matters on its own: the sort, the healthy/problem
 * partition and the dot each used to call deriveHealthState separately, so a
 * twenty-piste board ran it sixty times a render — and, now that the state
 * depends on the clock, three calls straddling a tick could disagree with each
 * other about the same row.
 */
export function useBoardStates(
  rows: BoardRow[] | null,
  nowMs: number,
  matchDurationMinutes: number,
): (row: BoardRow) => HealthState {
  const byLiceId = useMemo(() => {
    const map = new Map<string, HealthState>();
    for (const row of rows ?? []) {
      map.set(row.lice.id, deriveHealthState({ row, nowMs, matchDurationMinutes }));
    }
    return map;
  }, [rows, nowMs, matchDurationMinutes]);

  return (row: BoardRow) => byLiceId.get(row.lice.id) ?? 'unknown';
}
