import { describe, expect, it } from 'vitest';
import { placeMultiWithShift, placeWithShift, type PlaceableItem } from './place-with-shift';

const END = 144; // 12h × 12 slots/h = 144

function item(id: string, slot: number, span = 1): PlaceableItem {
  return { id, slot, span };
}

describe('placeWithShift', () => {
  it('places the dropped item at dropSlot when nothing is in the way', () => {
    const result = placeWithShift({
      items: [item('a', 0), item('b', 5)],
      dropped: item('drop', 1),
      dropSlot: 2,
      gridEndSlot: END,
    });
    expect(result.shifted).toEqual([]);
    expect(result.upwardFallback).toBe(false);
    const drop = result.items.find((i) => i.id === 'drop')!;
    expect(drop.slot).toBe(2);
  });

  it('shifts a single occupant downward when the drop lands on top of it', () => {
    const result = placeWithShift({
      items: [item('a', 2, 2)],
      dropped: item('drop', 2),
      dropSlot: 2,
      gridEndSlot: END,
    });
    expect(result.upwardFallback).toBe(false);
    const drop = result.items.find((i) => i.id === 'drop')!;
    const a = result.items.find((i) => i.id === 'a')!;
    expect(drop.slot).toBe(2);
    // 'a' must start at-or-after drop.slot + drop.span = 3.
    expect(a.slot).toBeGreaterThanOrEqual(drop.slot + drop.span);
    expect(result.shifted.map((i) => i.id)).toEqual(['a']);
  });

  it('cascades the shift when pushing one occupant collides with the next', () => {
    // Three back-to-back items at 0, 2, 4. Drop a 2-span item at 0
    // pushes them all forward by 2 slots.
    const result = placeWithShift({
      items: [item('a', 0, 2), item('b', 2, 2), item('c', 4, 2)],
      dropped: item('drop', 0, 2),
      dropSlot: 0,
      gridEndSlot: END,
    });
    expect(result.upwardFallback).toBe(false);
    const byId = Object.fromEntries(result.items.map((i) => [i.id, i.slot]));
    expect(byId.drop).toBe(0);
    expect(byId.a).toBe(2);
    expect(byId.b).toBe(4);
    expect(byId.c).toBe(6);
  });

  it('leaves a touching-but-not-overlapping occupant alone', () => {
    // Drop ends exactly where occupant starts.
    const result = placeWithShift({
      items: [item('a', 5, 2)],
      dropped: item('drop', 2, 3),
      dropSlot: 2,
      gridEndSlot: END,
    });
    expect(result.shifted).toEqual([]);
    expect(result.items.find((i) => i.id === 'a')!.slot).toBe(5);
  });

  it('falls back to upward shift when downward would run past the grid end', () => {
    // Occupant sits right against the grid end; can't push it down.
    const result = placeWithShift({
      items: [item('tail', END - 1, 1)],
      dropped: item('drop', 1),
      dropSlot: END - 1,
      gridEndSlot: END,
    });
    expect(result.upwardFallback).toBe(true);
    const drop = result.items.find((i) => i.id === 'drop')!;
    const tail = result.items.find((i) => i.id === 'tail')!;
    expect(drop.slot).toBe(END - 1);
    // Tail moved up to make room.
    expect(tail.slot).toBeLessThan(END - 1);
  });

  it('does not move items above the drop point in the normal (downward) path', () => {
    const result = placeWithShift({
      items: [item('above', 0, 2), item('on', 5, 2)],
      dropped: item('drop', 2),
      dropSlot: 5,
      gridEndSlot: END,
    });
    expect(result.upwardFallback).toBe(false);
    expect(result.items.find((i) => i.id === 'above')!.slot).toBe(0);
    expect(result.shifted.map((i) => i.id)).toEqual(['on']);
  });
});

// ── Multi-item (pool) drop ────────────────────────────────────────

describe('placeMultiWithShift', () => {
  it('lays a 3-match pool sequentially when the target stretch is empty', () => {
    const result = placeMultiWithShift({
      items: [],
      dropped: [item('p1', 0, 1), item('p2', 0, 1), item('p3', 0, 1)],
      dropSlot: 10,
      gridEndSlot: END,
    });
    expect(result.upwardFallback).toBe(false);
    expect(result.items.map((i) => [i.id, i.slot])).toEqual([
      ['p1', 10],
      ['p2', 11],
      ['p3', 12],
    ]);
    expect(result.shifted.map((i) => i.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('shifts a single existing occupant past the pool tail when it collides with the drop slot', () => {
    const result = placeMultiWithShift({
      items: [item('existing', 10, 2)],
      dropped: [item('p1', 0, 1), item('p2', 0, 1), item('p3', 0, 1)],
      dropSlot: 10,
      gridEndSlot: END,
    });
    expect(result.upwardFallback).toBe(false);
    // Pool occupies slots 10, 11, 12 → existing must start at 13.
    expect(result.items.find((i) => i.id === 'existing')!.slot).toBe(13);
  });

  it('cascades multiple downstream items past the pool without losing order', () => {
    const result = placeMultiWithShift({
      items: [item('a', 10, 2), item('b', 12, 2), item('c', 14, 2)],
      dropped: [item('p1', 0, 1), item('p2', 0, 1), item('p3', 0, 1)],
      dropSlot: 10,
      gridEndSlot: END,
    });
    expect(result.upwardFallback).toBe(false);
    // Pool ends at 13; a → 13, b pushes past a (15), c pushes past b (17).
    const byId = Object.fromEntries(result.items.map((i) => [i.id, i.slot]));
    expect(byId.a).toBe(13);
    expect(byId.b).toBe(15);
    expect(byId.c).toBe(17);
  });

  it('falls back to upward shift when downward would overflow the grid end', () => {
    const result = placeMultiWithShift({
      items: [item('above', 0, 1), item('tail', END - 1, 1)],
      dropped: [item('p1', 0, 1), item('p2', 0, 1)],
      dropSlot: END - 2,
      gridEndSlot: END,
    });
    expect(result.upwardFallback).toBe(true);
    // Pool sits at END-2 and END-1 → `tail` (was at END-1) can't be
    // pushed past the grid end, so the upward path kicks in.
    // The 'above' item gets pushed up to make room.
    const byId = Object.fromEntries(result.items.map((i) => [i.id, i.slot]));
    expect(byId.p1).toBe(END - 2);
    expect(byId.p2).toBe(END - 1);
  });

  it('returns the items unchanged when the dropped pool is empty', () => {
    const result = placeMultiWithShift({
      items: [item('a', 5, 2)],
      dropped: [],
      dropSlot: 10,
      gridEndSlot: END,
    });
    expect(result.shifted).toEqual([]);
    expect(result.items).toEqual([item('a', 5, 2)]);
  });
});
