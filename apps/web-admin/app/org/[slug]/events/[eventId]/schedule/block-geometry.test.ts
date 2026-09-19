import { describe, expect, it } from 'vitest';
import { SLOT_MINUTES } from '@myclash/schedule-core';
import {
  barWarningSlotSpan,
  clampBlockSpan,
  matchSlotSpan,
  respaceBlockSlots,
  retimeBlockMinutes,
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
    // If this ever inverts, the board would warn LESS than it draws, which is
    // the dangerous direction. Compares the two named functions, not a copy of
    // one of them: an inline `Math.round` here would pass while the real
    // detector used something else entirely.
    for (let duration = 1; duration <= 60; duration++) {
      expect(matchSlotSpan(duration)).toBeLessThanOrEqual(barWarningSlotSpan(duration));
    }
  });

  it('draws the sheet defaults 5, 8 and 10 on 1, 1 and 2 rows, and warns on 1, 2 and 2', () => {
    // GET /events/:id/schedule sends real lengths; the planner's sheet defaults
    // are 5 (pool), 8 (elimination) and 10 (finals) minutes. At 8 the two spans
    // differ: drawn as one row, warned on as two. The direction test above
    // would still pass if the warning floored too. The drawn values floor on
    // purpose — a ceiling draws two back-to-back 8-minute bouts on top of each
    // other — and nothing that moves a bout reads them (see `matchSlotSpan`).
    expect([matchSlotSpan(5), barWarningSlotSpan(5)]).toEqual([1, 1]);
    expect([matchSlotSpan(8), barWarningSlotSpan(8)]).toEqual([1, 2]);
    expect([matchSlotSpan(10), barWarningSlotSpan(10)]).toEqual([2, 2]);
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

describe('retimeBlockMinutes', () => {
  // Minutes on the axis, read straight from the fake instant: a run at 163, 171
  // and 179 is 10:43, 10:51 and 10:59 on an 08:00 axis — between rows, 8 apart.
  const minuteOf = (iso: string) => Number(iso);
  const matches = [at('a', 'L1', '163'), at('b', 'L1', '171'), at('c', 'L2', '179')];

  it('shifts every match by the same minutes from its exact start', () => {
    const out = retimeBlockMinutes({ matches, deltaMinutes: 17, minuteOf });
    expect(out).toEqual([
      { id: 'a', liceId: 'L1', atMinutes: 180 },
      { id: 'b', liceId: 'L1', atMinutes: 188 },
      { id: 'c', liceId: 'L2', atMinutes: 196 },
    ]);
  });

  it('shifts backwards too', () => {
    const out = retimeBlockMinutes({ matches, deltaMinutes: -13, minuteOf });
    expect(out.map((o) => o.atMinutes)).toEqual([150, 158, 166]);
  });

  it('issues no writes when the block does not move', () => {
    expect(retimeBlockMinutes({ matches, deltaMinutes: 0, minuteOf })).toEqual([]);
  });

  it('keeps every match on its own lice', () => {
    const out = retimeBlockMinutes({ matches, deltaMinutes: 17, minuteOf });
    expect(out.map((o) => o.liceId)).toEqual(['L1', 'L1', 'L2']);
  });
});
