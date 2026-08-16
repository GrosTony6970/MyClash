import { describe, expect, it } from 'vitest';
import { detectLiceStacks, wouldOverlap, type LiceStackMatch } from './detect-overlaps';

const T = (h: number, m = 0) => new Date(Date.UTC(2027, 5, 21, h, m)).toISOString();
const TZ = 'UTC';
const NAMES = new Map([
  ['l1', 'Lice 1'],
  ['l2', 'Lice 2'],
  ['l3', 'Lice 3'],
]);
const UNKNOWN = 'Unnamed lice';

let seq = 0;
function bout(over: Partial<LiceStackMatch>): LiceStackMatch {
  return {
    id: `m-${++seq}`,
    matchNumberLabel: `M${seq}`,
    status: 'scheduled',
    liceId: 'l1',
    scheduledAt: T(9),
    durationMinutes: 30,
    ...over,
  };
}

const stacks = (matches: LiceStackMatch[]) => detectLiceStacks(matches, TZ, NAMES, UNKNOWN);

/**
 * These five carry over the scenarios the block-level detector was tested on,
 * with their verdicts unchanged. They were the reason to believe the fold was
 * load-bearing; each of them holds at match level too, which is how we know it
 * was not.
 */
describe('detectLiceStacks — the block detector’s cases, at match level', () => {
  it('returns nothing for back-to-back bouts on one lice', () => {
    expect(stacks([bout({ scheduledAt: T(9) }), bout({ scheduledAt: T(9, 30) })])).toEqual([]);
  });

  it('flags two bouts overlapping in time on the same lice', () => {
    const out = stacks([
      bout({ id: 'a', scheduledAt: T(9) }),
      bout({ id: 'b', scheduledAt: T(9, 15) }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.matchIds).toEqual(['a', 'b']);
    expect(out[0]!.liceId).toBe('l1');
  });

  it('does not flag same-time bouts on different lices', () => {
    expect(
      stacks([
        bout({ liceId: 'l1', scheduledAt: T(9) }),
        bout({ liceId: 'l2', scheduledAt: T(9) }),
      ]),
    ).toEqual([]);
  });

  it('flags a wide bracket run overlapping a pool on a shared lice', () => {
    const out = stacks([
      bout({ id: 'r16-l1', liceId: 'l1', scheduledAt: T(10), durationMinutes: 40 }),
      bout({ id: 'r16-l2', liceId: 'l2', scheduledAt: T(10), durationMinutes: 40 }),
      bout({ id: 'r16-l3', liceId: 'l3', scheduledAt: T(10), durationMinutes: 40 }),
      bout({ id: 'pool', liceId: 'l2', scheduledAt: T(10, 20), durationMinutes: 40 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.liceId).toBe('l2');
    expect(out[0]!.matchIds).toEqual(['r16-l2', 'pool']);
  });

  it('does NOT flag two wide runs that pipeline sequentially on each shared lice', () => {
    // R16 then QF both span l1+l2. Their GLOBAL intervals overlap but PER LICE
    // every fight is back-to-back — no real clash. (durationMinutes omitted →
    // 5-min slot fallback.)
    expect(
      stacks([
        bout({ liceId: 'l1', scheduledAt: T(9), durationMinutes: undefined }),
        bout({ liceId: 'l2', scheduledAt: T(9, 5), durationMinutes: undefined }),
        bout({ liceId: 'l1', scheduledAt: T(9, 5), durationMinutes: undefined }),
        bout({ liceId: 'l2', scheduledAt: T(9, 10), durationMinutes: undefined }),
      ]),
    ).toEqual([]);
  });
});

describe('detectLiceStacks', () => {
  /**
   * THE REGRESSION LOCK for this whole slice.
   *
   * `programme/generate` fans a pool across every lice in parallel, so its
   * bouts share a start time. `setPoolLice` then pins the pool to one strip and
   * leaves the clock alone — four bouts, one strip, one instant. The block
   * detector folded a pool into ONE interval and a block cannot overlap itself,
   * so this reported nothing at all. 07-populate-event does it to eight pools.
   */
  it('sees four bouts of one pool stacked on one lice at one instant', () => {
    const out = stacks([
      bout({ id: 'p1', scheduledAt: T(10) }),
      bout({ id: 'p2', scheduledAt: T(10) }),
      bout({ id: 'p3', scheduledAt: T(10) }),
      bout({ id: 'p4', scheduledAt: T(10) }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.matchIds).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  /**
   * The other half of the block detector's fault. Two pools taking turns on one
   * strip is a legitimate schedule; folding them made it look like a clash.
   */
  it('does not flag two pools interleaved on one lice', () => {
    const out = stacks([
      bout({ id: 'a1', scheduledAt: T(10), durationMinutes: 10 }),
      bout({ id: 'b1', scheduledAt: T(10, 10), durationMinutes: 10 }),
      bout({ id: 'a2', scheduledAt: T(10, 20), durationMinutes: 10 }),
    ]);
    expect(out).toEqual([]);
  });

  it('flags two tournaments on one lice, which share no fighter', () => {
    // The gap the whole feature exists to close: the fighter banner tests time
    // overlap only AFTER finding a shared registration, so two tournaments on
    // one strip reported nothing.
    const out = stacks([
      bout({ id: 'longsword', scheduledAt: T(11) }),
      bout({ id: 'sidesword', scheduledAt: T(11, 10) }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.matchIds).toEqual(['longsword', 'sidesword']);
  });

  it('ignores a voided bout, which is not occupying the strip', () => {
    expect(
      stacks([bout({ scheduledAt: T(10) }), bout({ scheduledAt: T(10), status: 'voided' })]),
    ).toEqual([]);
  });

  it('ignores a bout with no lice or no time', () => {
    expect(
      stacks([
        bout({ scheduledAt: T(10) }),
        bout({ scheduledAt: T(10), liceId: null }),
        bout({ scheduledAt: null }),
      ]),
    ).toEqual([]);
  });

  it('survives an unreadable timestamp instead of colliding with everything', () => {
    const out = stacks([bout({ scheduledAt: T(10) }), bout({ scheduledAt: 'not-a-date' })]);
    expect(out).toEqual([]);
  });

  it('reports a chained run once, not once per pair', () => {
    // A–B overlap and B–C overlap; A and C do not touch. One row of three, not
    // two rows of two — every bout named still overlaps at least one other.
    const out = stacks([
      bout({ id: 'a', scheduledAt: T(10), durationMinutes: 10 }),
      bout({ id: 'b', scheduledAt: T(10, 5), durationMinutes: 10 }),
      bout({ id: 'c', scheduledAt: T(10, 12), durationMinutes: 10 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.matchIds).toEqual(['a', 'b', 'c']);
  });

  it('names the lice, and never prints a lice id', () => {
    const out = stacks([
      bout({ liceId: 'l3', scheduledAt: T(10) }),
      bout({ liceId: 'l3', scheduledAt: T(10) }),
    ]);
    expect(out[0]!.liceName).toBe('Lice 3');

    const unnamed = stacks([
      bout({ liceId: 'lice-not-in-the-map', scheduledAt: T(10) }),
      bout({ liceId: 'lice-not-in-the-map', scheduledAt: T(10) }),
    ]);
    expect(unnamed[0]!.liceName).toBe(UNKNOWN);
    expect(unnamed[0]!.liceName).not.toContain('lice-not-in-the-map');
  });

  it('labels each bout the way its card does', () => {
    const out = stacks([
      bout({ matchNumberLabel: '2', roundCode: 'LSW-B-QF-M2', scheduledAt: T(10) }),
      bout({ matchNumberLabel: 'L1-PA-M5', scheduledAt: T(10) }),
    ]);
    expect(out[0]!.matchLabels).toEqual(['LSW-B-QF-M2', 'L1-PA-M5']);
  });

  /**
   * The time is on the EVENT's wall clock, not the viewer's — the fault
   * `conflict-detection.ts` records in its own header, where a Paris clash at
   * 09:00 read as 03:00 to an organiser on a US laptop.
   */
  it('reports the time on the event clock', () => {
    const at = '2026-05-29T07:00:00.000Z';
    const paris = detectLiceStacks(
      [bout({ scheduledAt: at }), bout({ scheduledAt: at })],
      'Europe/Paris',
      NAMES,
      UNKNOWN,
    );
    expect(paris[0]!.time).toBe('09:00');

    const newYork = detectLiceStacks(
      [bout({ scheduledAt: at }), bout({ scheduledAt: at })],
      'America/New_York',
      NAMES,
      UNKNOWN,
    );
    expect(newYork[0]!.time).toBe('03:00');
  });
});

describe('wouldOverlap (prospective drop, slot-based)', () => {
  const occupants = [
    { liceIds: ['l1'], startSlot: 0, endSlot: 6 },
    { liceIds: ['l2'], startSlot: 6, endSlot: 12 },
  ];

  it('is false on an empty lice', () => {
    expect(wouldOverlap({ liceIds: ['l3'], startSlot: 0, endSlot: 6 }, occupants)).toBe(false);
  });

  it('is false for a back-to-back placement on the same lice', () => {
    expect(wouldOverlap({ liceIds: ['l1'], startSlot: 6, endSlot: 12 }, occupants)).toBe(false);
  });

  it('is true when ranges intersect on a shared lice', () => {
    expect(wouldOverlap({ liceIds: ['l1'], startSlot: 3, endSlot: 9 }, occupants)).toBe(true);
  });

  it('is true for a wide placement spanning into an occupied lice', () => {
    expect(wouldOverlap({ liceIds: ['l3', 'l2'], startSlot: 8, endSlot: 10 }, occupants)).toBe(
      true,
    );
  });

  it('ignores the block being moved (excluded by the caller)', () => {
    expect(wouldOverlap({ liceIds: ['l1'], startSlot: 0, endSlot: 6 }, [])).toBe(false);
  });
});
