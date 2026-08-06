import { describe, expect, it } from 'vitest';
import { groupBoardRows } from './board-groups';
import { mkRow } from './live-board.fixtures';
import type { BoardRow } from './types';

function at(id: string, sortOrder: number, venue: string | null, area: string | null): BoardRow {
  const base = mkRow();
  return {
    ...base,
    lice: {
      ...base.lice,
      id,
      name: id,
      sortOrder,
      venue: venue ? { id: venue, name: venue } : null,
      area: area ? { id: area, name: area } : null,
    },
  };
}

describe('groupBoardRows', () => {
  it('returns one unlabelled group when every piste is in the same place', () => {
    // A section header over the only section is chrome, not information — the
    // board stays the flat list it has always been.
    const rows = [at('A', 0, 'Hall', null), at('B', 1, 'Hall', null)];
    expect(groupBoardRows(rows)).toEqual([{ key: 'all', label: null, rows }]);
  });

  it('returns one unlabelled group when no piste has a placement at all', () => {
    const rows = [at('A', 0, null, null), at('B', 1, null, null)];
    const groups = groupBoardRows(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBeNull();
  });

  it('sections by venue and area once the event spans more than one', () => {
    const rows = [at('A', 0, 'North', 'Left'), at('B', 1, 'South', null)];
    const groups = groupBoardRows(rows);
    expect(groups).toHaveLength(2);
    // Separator comes from placementLabel, so the board reads exactly as the
    // public display hub does.
    expect(groups.map((g) => g.label)).toEqual(['North — Left', 'South']);
    expect(groups[0]!.rows.map((r) => r.lice.id)).toEqual(['A']);
    expect(groups[1]!.rows.map((r) => r.lice.id)).toEqual(['B']);
  });

  it("preserves the caller's row order inside a section", () => {
    // groupLicesByPlacement orders by sortOrder. Re-reading from the caller's
    // array is what stops that silently undoing a worst-first sort.
    const rows = [
      at('late', 9, 'North', null),
      at('early', 0, 'North', null),
      at('B', 1, 'South', null),
    ];
    const north = groupBoardRows(rows)[0]!;
    expect(north.rows.map((r) => r.lice.id)).toEqual(['late', 'early']);
  });

  it('keeps unplaced pistes in their own trailing section', () => {
    const rows = [at('placed', 0, 'North', null), at('loose', 1, null, null)];
    const groups = groupBoardRows(rows);
    expect(groups).toHaveLength(2);
    expect(groups[groups.length - 1]!.rows.map((r) => r.lice.id)).toEqual(['loose']);
  });

  it('loses no row to grouping', () => {
    const rows = [at('A', 0, 'North', 'L'), at('B', 1, 'North', 'R'), at('C', 2, null, null)];
    const grouped = groupBoardRows(rows).flatMap((g) => g.rows.map((r) => r.lice.id));
    expect(grouped.sort()).toEqual(['A', 'B', 'C']);
  });
});
