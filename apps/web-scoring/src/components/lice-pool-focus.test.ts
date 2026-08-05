import { describe, expect, it } from 'vitest';
import {
  buildLiceBracketFocus,
  buildLicePoolSummaries,
  orderLicePoolSummaries,
  type FocusPool,
} from './lice-pool-focus';

const pool = (poolId: string, matches: Array<[string, string | null]>): FocusPool => ({
  poolId,
  poolName: poolId.toUpperCase(),
  matches: matches.map(([id, lice_id]) => ({ id, lice_id })),
});

describe('buildLicePoolSummaries', () => {
  it('counts mine against the pool total', () => {
    const summaries = buildLicePoolSummaries(
      [
        pool('p1', [
          ['m1', 'lice-4'],
          ['m2', 'lice-4'],
          ['m3', 'lice-2'],
        ]),
      ],
      'lice-4',
    );
    expect(summaries[0]).toMatchObject({
      poolId: 'p1',
      onThisLice: ['m1', 'm2'],
      total: 3,
      anyOnThisLice: true,
    });
  });

  it('keeps pools that touch this lice not at all', () => {
    // "Display them all" — a pool with nothing here is still context.
    const summaries = buildLicePoolSummaries([pool('p2', [['m9', 'lice-2']])], 'lice-4');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ onThisLice: [], anyOnThisLice: false, total: 1 });
  });

  it('handles a pool split across two pistes without claiming it', () => {
    // `pools` has no lice_id; a split pool is legal, so the count must be honest.
    const summaries = buildLicePoolSummaries(
      [
        pool('p1', [
          ['m1', 'lice-4'],
          ['m2', 'lice-2'],
        ]),
      ],
      'lice-4',
    );
    expect(summaries[0]?.onThisLice).toEqual(['m1']);
    expect(summaries[0]?.total).toBe(2);
  });

  it('treats unassigned matches as belonging to no lice', () => {
    const summaries = buildLicePoolSummaries([pool('p1', [['m1', null]])], 'lice-4');
    expect(summaries[0]?.anyOnThisLice).toBe(false);
  });

  it('returns an empty list for no pools', () => {
    expect(buildLicePoolSummaries([], 'lice-4')).toEqual([]);
  });

  it('carries the pool crew and the pistes through for the header', () => {
    const summaries = buildLicePoolSummaries(
      [
        {
          poolId: 'p1',
          poolName: 'Pool 1',
          referees: [
            {
              role: 'arbitre_declarant',
              roleLabel: 'Déclarant',
              roleColor: 'orange',
              name: 'Marc',
            },
          ],
          liceNames: ['Lice 1', 'Lice 2'],
          matches: [{ id: 'm1', lice_id: 'lice-4' }],
        },
      ],
      'lice-4',
    );
    expect(summaries[0]?.referees).toEqual([
      { role: 'arbitre_declarant', roleLabel: 'Déclarant', roleColor: 'orange', name: 'Marc' },
    ]);
    expect(summaries[0]?.liceNames).toEqual(['Lice 1', 'Lice 2']);
  });

  it('defaults crew and pistes to empty when the payload omits them', () => {
    const summaries = buildLicePoolSummaries([pool('p1', [['m1', 'lice-4']])], 'lice-4');
    expect(summaries[0]?.referees).toEqual([]);
    expect(summaries[0]?.liceNames).toEqual([]);
  });
});

describe('orderLicePoolSummaries', () => {
  const summaries = buildLicePoolSummaries(
    [
      pool('p1', [['m1', 'lice-2']]),
      pool('p2', [['m2', 'lice-2']]),
      pool('p3', [['m3', 'lice-4']]),
      pool('p4', [['m4', 'lice-4']]),
    ],
    'lice-4',
  );

  it('floats this pistes pools to the front', () => {
    expect(orderLicePoolSummaries(summaries).map((s) => s.poolId)).toEqual([
      'p3',
      'p4',
      'p1',
      'p2',
    ]);
  });

  it('is stable — the organisers sort_order survives inside each half', () => {
    // A comparator-based sort would be free to reorder the pools the operator
    // is NOT on, which would make this section disagree with every other pool
    // list in the product.
    const ordered = orderLicePoolSummaries(summaries);
    expect(ordered.filter((s) => !s.anyOnThisLice).map((s) => s.poolId)).toEqual(['p1', 'p2']);
  });

  it('leaves the order untouched when no pool is on this lice', () => {
    const none = buildLicePoolSummaries([pool('p1', [['m1', 'lice-2']])], 'lice-9');
    expect(orderLicePoolSummaries(none).map((s) => s.poolId)).toEqual(['p1']);
  });

  it('does not mutate its input', () => {
    const before = summaries.map((s) => s.poolId);
    orderLicePoolSummaries(summaries);
    expect(summaries.map((s) => s.poolId)).toEqual(before);
  });
});

describe('buildLiceBracketFocus', () => {
  const slots = [
    { id: 's-r2-p1', round: 2, position: 1, liceId: 'lice-4' },
    { id: 's-r1-p2', round: 1, position: 2, liceId: 'lice-4' },
    { id: 's-r1-p1', round: 1, position: 1, liceId: 'lice-2' },
    { id: 's-r3-p1', round: 3, position: 1, liceId: null },
  ];

  it('highlights only this licess slots', () => {
    const focus = buildLiceBracketFocus(slots, 'lice-4');
    expect(focus.highlightedSlotIds).toEqual(['s-r2-p1', 's-r1-p2']);
    expect(focus.count).toBe(2);
  });

  it('scrolls to the earliest bout — lowest round, then lowest position', () => {
    expect(buildLiceBracketFocus(slots, 'lice-4').scrollTargetSlotId).toBe('s-r1-p2');
  });

  it('breaks a round tie on position', () => {
    const tied = [
      { id: 'late', round: 1, position: 4, liceId: 'l1' },
      { id: 'early', round: 1, position: 2, liceId: 'l1' },
    ];
    expect(buildLiceBracketFocus(tied, 'l1').scrollTargetSlotId).toBe('early');
  });

  it('has no scroll target when the lice hosts nothing in this bracket', () => {
    const focus = buildLiceBracketFocus(slots, 'lice-99');
    expect(focus).toEqual({ highlightedSlotIds: [], scrollTargetSlotId: null, count: 0 });
  });
});
