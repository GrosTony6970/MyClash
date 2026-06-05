import { describe, expect, it } from 'vitest';
import { placeWithShift, type PlaceableItem } from './place-with-shift';

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
