import { groupLicesByPlacement, placementLabel, type HubLice } from '@myclash/types';
import type { BoardRow } from './types';

/** Board rows for one venue/area, in the order the display hub would show them. */
export interface BoardGroup {
  key: string;
  /** null when these pistes have no venue or area set — the flat trailing group. */
  label: string | null;
  rows: BoardRow[];
}

/**
 * Split rows into venue/area sections, or a single unlabelled section.
 *
 * Reuses the public display hub's grouping so an operator moving between the
 * two sees the same sections in the same order. Returns ONE group when the
 * event is not split across places — a section header over the only section is
 * chrome, not information, and the board stays a flat list as it is today.
 *
 * Row order WITHIN a group is preserved, so whatever sort the caller applied
 * (piste order, or worst-first) still holds inside each section.
 */
export function groupBoardRows(rows: BoardRow[]): BoardGroup[] {
  const byLiceId = new Map(rows.map((r) => [r.lice.id, r]));
  const hubLices: HubLice[] = rows.map((r) => ({
    id: r.lice.id,
    name: r.lice.name,
    sortOrder: r.lice.sortOrder,
    venue: r.lice.venue,
    area: r.lice.area,
  }));

  const groups = groupLicesByPlacement(hubLices);
  if (groups.length <= 1) {
    return [{ key: 'all', label: null, rows }];
  }

  return groups.map((g) => ({
    key: g.key,
    label: placementLabel(g.venueName, g.areaName),
    // Re-read from the caller's array rather than from the grouped HubLice, so
    // the caller's sort survives: groupLicesByPlacement orders by sortOrder,
    // which would silently undo worst-first.
    rows: rows.filter((r) => g.lices.some((l) => l.id === r.lice.id && byLiceId.has(l.id))),
  }));
}
