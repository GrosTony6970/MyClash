import { describe, expect, it } from 'vitest';
import {
  breakTimesFromSlots,
  findWorkshopOverlaps,
  placeWorkshopBlock,
} from './workshop-placement';

const GRID_END = 144; // 08:00–20:00 in 5-min slots

describe('placeWorkshopBlock', () => {
  it('places the dropped block at the drop slot when nothing collides', () => {
    const r = placeWorkshopBlock({
      occupants: [],
      obstacles: [],
      dropped: { span: 12 },
      dropSlot: 24,
      gridEndSlot: GRID_END,
    });
    expect(r).toEqual({ slot: 24, shifted: [] });
  });

  it('pushes the dropped block past a fixed break (obstacle)', () => {
    const r = placeWorkshopBlock({
      occupants: [],
      obstacles: [{ slot: 12, span: 12 }], // 09:00–10:00 break
      dropped: { span: 12 },
      dropSlot: 12,
      gridEndSlot: GRID_END,
    });
    expect(r.slot).toBe(24); // lands right after the break
    expect(r.shifted).toEqual([]);
  });

  it('shifts an overlapping occupant down below the dropped block', () => {
    const r = placeWorkshopBlock({
      occupants: [{ id: 'a', slot: 12, span: 12 }],
      obstacles: [],
      dropped: { span: 12 },
      dropSlot: 12,
      gridEndSlot: GRID_END,
    });
    expect(r.slot).toBe(12);
    expect(r.shifted).toEqual([{ id: 'a', slot: 24 }]);
  });

  it('cascades a shifted occupant past an intervening break', () => {
    const r = placeWorkshopBlock({
      occupants: [{ id: 'a', slot: 12, span: 12 }],
      obstacles: [{ slot: 24, span: 6 }], // break right below the dropped tail
      dropped: { span: 12 },
      dropSlot: 12,
      gridEndSlot: GRID_END,
    });
    expect(r.slot).toBe(12);
    expect(r.shifted).toEqual([{ id: 'a', slot: 30 }]); // past dropped (24) then break (30)
  });

  it('leaves blocks above the drop point untouched', () => {
    const r = placeWorkshopBlock({
      occupants: [{ id: 'a', slot: 0, span: 6 }],
      obstacles: [],
      dropped: { span: 6 },
      dropSlot: 12,
      gridEndSlot: GRID_END,
    });
    expect(r.slot).toBe(12);
    expect(r.shifted).toEqual([]);
  });

  it('clamps a shifted occupant to the grid end on overflow', () => {
    const r = placeWorkshopBlock({
      occupants: [{ id: 'a', slot: 12, span: 12 }],
      obstacles: [],
      dropped: { span: 12 },
      dropSlot: 12,
      gridEndSlot: 30,
    });
    expect(r.slot).toBe(12);
    expect(r.shifted).toEqual([{ id: 'a', slot: 18 }]); // 24 would overflow → clamp to 30−12
  });
});

describe('findWorkshopOverlaps', () => {
  const block = (sessionId: string, columnKey: string, startSlot: number, endSlot: number) => ({
    sessionId,
    columnKey,
    startSlot,
    endSlot,
  });

  it('flags two blocks that overlap in the same column', () => {
    const set = findWorkshopOverlaps([block('a', 'c1', 0, 12), block('b', 'c1', 6, 18)]);
    expect(set.has('a')).toBe(true);
    expect(set.has('b')).toBe(true);
  });

  it('ignores blocks that merely touch', () => {
    const set = findWorkshopOverlaps([block('a', 'c1', 0, 12), block('b', 'c1', 12, 24)]);
    expect(set.size).toBe(0);
  });

  it('ignores same-time blocks in different columns', () => {
    const set = findWorkshopOverlaps([block('a', 'c1', 0, 12), block('b', 'c2', 0, 12)]);
    expect(set.size).toBe(0);
  });
});

describe('breakTimesFromSlots', () => {
  it('maps slots to HH:MM at the given start hour', () => {
    expect(breakTimesFromSlots(0, 12, 8)).toEqual({ startTime: '08:00', endTime: '09:00' });
    expect(breakTimesFromSlots(6, 18, 8)).toEqual({ startTime: '08:30', endTime: '09:30' });
    expect(breakTimesFromSlots(0, 12, 9)).toEqual({ startTime: '09:00', endTime: '10:00' });
  });
});
