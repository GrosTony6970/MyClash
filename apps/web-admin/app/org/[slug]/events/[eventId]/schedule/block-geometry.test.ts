import { describe, expect, it } from 'vitest';
import { SLOT_MINUTES } from '@myclash/schedule-core';
import {
  barWarningSlotSpan,
  clampBlockSpan,
  matchSlotSpan,
  respaceBlockSlots,
  retimeBlockSlots,
  type PlacedBlockMatch,
} from './block-geometry';

/**
 * These pin arithmetic that had no cover at all: it lived inline in a
 * 3000-line component, at eleven call sites, some of which had already drifted.
 */

const at = (id: string, liceId: string, startIso: string): PlacedBlockMatch => ({
  id,
  liceId,
  startIso,
});

describe('matchSlotSpan', () => {
  it('floors a duration into whole slots', () => {
    expect(matchSlotSpan(SLOT_MINUTES * 3)).toBe(3);
    expect(matchSlotSpan(SLOT_MINUTES * 3 + 1)).toBe(3);
    expect(matchSlotSpan(SLOT_MINUTES * 4 - 1)).toBe(3);
  });

  it('never returns a span a block could not be drawn at', () => {
    // A zero or negative duration reaches here from bad seed data; the board
    // must still draw something rather than a zero-height card.
    for (const duration of [0, 1, SLOT_MINUTES - 1, -5]) {
      expect(matchSlotSpan(duration)).toBe(1);
    }
  });

  it('is never larger than the span the collision detector warns on', () => {
    // If this ever inverts, the board would warn LESS than it places, which is
    // the dangerous direction. Compares the two named functions, not a copy of
    // one of them: an inline `Math.round` here would pass while the real
    // detector used something else entirely.
    for (let duration = 1; duration <= 60; duration++) {
      expect(matchSlotSpan(duration)).toBeLessThanOrEqual(barWarningSlotSpan(duration));
    }
  });

  it('agrees with the warning span on every duration the API actually sends', () => {
    // GET /events/:id/schedule returns a constant durationMinutes of 5, equal to
    // SLOT_MINUTES. So the two spans are the same number for every match the
    // board draws, and the divergence above is latent rather than live. This
    // reds if that constant moves off a slot boundary — at which point the
    // divergence becomes real and someone has to decide it on purpose.
    expect(barWarningSlotSpan(SLOT_MINUTES)).toBe(matchSlotSpan(SLOT_MINUTES));
  });
});

describe('clampBlockSpan', () => {
  const base = { startSpan: 4, startSlot: 10, gridEndSlot: 100 };

  it('applies the drag delta when it stays in range', () => {
    expect(clampBlockSpan({ ...base, deltaSlots: 3 })).toBe(7);
    expect(clampBlockSpan({ ...base, deltaSlots: -2 })).toBe(2);
  });

  it('never lets a block collapse or invert', () => {
    expect(clampBlockSpan({ ...base, deltaSlots: -4 })).toBe(1);
    expect(clampBlockSpan({ ...base, deltaSlots: -999 })).toBe(1);
  });

  it('never lets a block run past the axis', () => {
    expect(clampBlockSpan({ ...base, deltaSlots: 999 })).toBe(90);
    expect(clampBlockSpan({ startSpan: 4, startSlot: 96, gridEndSlot: 100, deltaSlots: 50 })).toBe(
      4,
    );
  });

  it('gives the same answer for a preview and its commit', () => {
    // The live preview and the pointerup commit computed this separately. Same
    // inputs must give the same span or the block jumps when the drag ends.
    const delta = 6;
    expect(clampBlockSpan({ ...base, deltaSlots: delta })).toBe(
      clampBlockSpan({ ...base, deltaSlots: delta }),
    );
  });
});

describe('respaceBlockSlots', () => {
  it('spreads one lice evenly between the two ends', () => {
    const out = respaceBlockSlots({
      matches: [
        at('a', 'L1', '2026-06-13T09:00:00Z'),
        at('b', 'L1', '2026-06-13T09:20:00Z'),
        at('c', 'L1', '2026-06-13T09:40:00Z'),
      ],
      startSlot: 0,
      endSlot: 12,
    });
    expect(out.map((o) => o.id)).toEqual(['a', 'b', 'c']);
    expect(out[0]!.slot).toBe(0);
    // Strictly increasing — two matches on one lice may never share a slot.
    expect(out[1]!.slot).toBeGreaterThan(out[0]!.slot);
    expect(out[2]!.slot).toBeGreaterThan(out[1]!.slot);
  });

  it('respaces each lice independently, as parallel queues', () => {
    const out = respaceBlockSlots({
      matches: [
        at('a1', 'L1', '2026-06-13T09:00:00Z'),
        at('b1', 'L2', '2026-06-13T09:00:00Z'),
        at('a2', 'L1', '2026-06-13T09:30:00Z'),
        at('b2', 'L2', '2026-06-13T09:30:00Z'),
      ],
      startSlot: 0,
      endSlot: 12,
    });
    const l1 = out.filter((o) => o.liceId === 'L1').map((o) => o.slot);
    const l2 = out.filter((o) => o.liceId === 'L2').map((o) => o.slot);
    // Two lices of equal length get identical layouts — they are not one queue.
    expect(l1).toEqual(l2);
  });

  it('orders by current start time, not by input order', () => {
    const out = respaceBlockSlots({
      matches: [
        at('late', 'L1', '2026-06-13T11:00:00Z'),
        at('early', 'L1', '2026-06-13T09:00:00Z'),
      ],
      startSlot: 0,
      endSlot: 12,
    });
    expect(out.map((o) => o.id)).toEqual(['early', 'late']);
  });

  it('returns nothing for a block with no matches', () => {
    expect(respaceBlockSlots({ matches: [], startSlot: 0, endSlot: 12 })).toEqual([]);
  });
});

describe('retimeBlockSlots', () => {
  const slotOf = (iso: string) => Number(iso);
  const matches = [at('a', 'L1', '10'), at('b', 'L1', '14'), at('c', 'L2', '10')];

  it('shifts every match by the same delta, keeping the internal layout', () => {
    const out = retimeBlockSlots({ matches, currentStartSlot: 10, newStartSlot: 30, slotOf });
    expect(out).toEqual([
      { id: 'a', liceId: 'L1', slot: 30 },
      { id: 'b', liceId: 'L1', slot: 34 },
      { id: 'c', liceId: 'L2', slot: 30 },
    ]);
  });

  it('shifts backwards too', () => {
    const out = retimeBlockSlots({ matches, currentStartSlot: 10, newStartSlot: 4, slotOf });
    expect(out.map((o) => o.slot)).toEqual([4, 8, 4]);
  });

  it('issues no writes when the block is already there', () => {
    expect(retimeBlockSlots({ matches, currentStartSlot: 10, newStartSlot: 10, slotOf })).toEqual(
      [],
    );
  });

  it('keeps every match on its own lice', () => {
    const out = retimeBlockSlots({ matches, currentStartSlot: 10, newStartSlot: 30, slotOf });
    expect(out.map((o) => o.liceId)).toEqual(['L1', 'L1', 'L2']);
  });
});
