import { describe, expect, it } from 'vitest';
import { DEFAULT_DURATION_MS } from './conflicts';
import { aggregateReferee, partitionAtBars, refereeAssignmentKey } from './schedule-model';
import type { RefereeSlot } from './types';

function slot(over: Partial<RefereeSlot>): RefereeSlot {
  return {
    matchId: 'm',
    matchNumberLabel: '',
    scheduledAt: null,
    startsAt: null,
    endsAt: null,
    role: 'ref',
    poolName: null,
    poolId: null,
    tournamentName: 'Longsword Open',
    tournamentSlug: 'lsw',
    liceName: null,
    matchKind: null,
    roundOfCount: null,
    bracketSlotId: null,
    skillName: 'Director',
    skillColor: 'blue',
    poolMatchCount: null,
    ...over,
  };
}

describe('refereeAssignmentKey', () => {
  it('groups pool matches by pool id', () => {
    const a = slot({ matchId: '1', matchKind: 'pool', poolId: 'p1' });
    const b = slot({ matchId: '2', matchKind: 'pool', poolId: 'p1' });
    const c = slot({ matchId: '3', matchKind: 'pool', poolId: 'p2' });
    expect(refereeAssignmentKey(a)).toBe(refereeAssignmentKey(b));
    expect(refereeAssignmentKey(a)).not.toBe(refereeAssignmentKey(c));
  });

  it('groups bracket matches by tier, separating rounds', () => {
    const r16 = slot({
      matchId: '1',
      matchKind: 'round_of',
      roundOfCount: 16,
      bracketSlotId: 's1',
    });
    const r16b = slot({
      matchId: '2',
      matchKind: 'round_of',
      roundOfCount: 16,
      bracketSlotId: 's2',
    });
    const qf = slot({ matchId: '3', matchKind: 'quarter_final', bracketSlotId: 's3' });
    expect(refereeAssignmentKey(r16)).toBe(refereeAssignmentKey(r16b));
    expect(refereeAssignmentKey(r16)).not.toBe(refereeAssignmentKey(qf));
  });
});

describe('aggregateReferee', () => {
  it('folds a whole pool into one card with a match count', () => {
    const slots = ['09:00', '09:22', '09:44'].map((hhmm, i) =>
      slot({
        matchId: `m${i}`,
        matchKind: 'pool',
        poolId: 'p1',
        poolName: 'Pool 4',
        scheduledAt: `2027-05-22T${hhmm}:00Z`,
        liceName: i === 1 ? 'Lice 4' : null,
      }),
    );
    const [agg] = aggregateReferee(slots);
    expect(agg).toBeDefined();
    expect(agg!.count).toBe(3);
    expect(agg!.poolName).toBe('Pool 4');
    // Representative lice is picked from whichever match carries one.
    expect(agg!.liceName).toBe('Lice 4');
    // Window spans first→last match (+ default duration for the last).
    expect(agg!.startIso).toBe('2027-05-22T09:00:00.000Z');
    expect(agg!.endMs).toBe(new Date('2027-05-22T09:44:00Z').getTime() + DEFAULT_DURATION_MS);
  });

  it('derives a pool-scoped card window from starts_at/ends_at when there is no match', () => {
    // A pool "Déclarant" assignment carries no match (scheduledAt null) — its
    // window must come from the assignment's own starts_at/ends_at so the
    // schedule can place it on the right day.
    const [agg] = aggregateReferee([
      slot({
        matchId: '',
        matchKind: 'pool',
        poolId: 'p1',
        poolName: 'Pool 1',
        liceName: 'Lice 1',
        scheduledAt: null,
        startsAt: '2027-05-22T13:00:00Z',
        endsAt: '2027-05-22T15:34:00Z',
        poolMatchCount: 15,
      }),
    ]);
    expect(agg).toBeDefined();
    expect(agg!.poolName).toBe('Pool 1');
    expect(agg!.liceName).toBe('Lice 1');
    expect(agg!.startIso).toBe('2027-05-22T13:00:00.000Z');
    expect(agg!.startMs).toBe(new Date('2027-05-22T13:00:00Z').getTime());
    expect(agg!.endMs).toBe(new Date('2027-05-22T15:34:00Z').getTime());
    // The card shows the pool's real bout count, not the single assignment row.
    expect(agg!.count).toBe(15);
  });

  it('keeps distinct pools / tiers as separate cards', () => {
    const slots = [
      slot({ matchId: '1', matchKind: 'pool', poolId: 'p1' }),
      slot({ matchId: '2', matchKind: 'pool', poolId: 'p2' }),
      slot({ matchId: '3', matchKind: 'final', bracketSlotId: 's1' }),
    ];
    expect(aggregateReferee(slots)).toHaveLength(3);
  });
});

describe('partitionAtBars', () => {
  const item = (id: string, sort: number) => ({ item: id, sort });
  const bar = (id: string, sort: number) => ({ bar: id, sort });

  it('splits a weapon block around a mid-day break', () => {
    // Matches 09:00, 09:30 then Lunch 12:00 then 14:00.
    const slices = partitionAtBars(
      [item('m9', 9), item('m930', 9.5), item('m14', 14)],
      [bar('lunch', 12)],
    );
    expect(slices.map((s) => s.type)).toEqual(['segment', 'bar', 'segment']);
    const [first, , second] = slices;
    expect(first!.type === 'segment' && first.items).toEqual(['m9', 'm930']);
    expect(second!.type === 'segment' && second.items).toEqual(['m14']);
  });

  it('places an early break above the commitments (bar before item at equal time)', () => {
    const slices = partitionAtBars([item('m9', 9)], [bar('reg', 8), bar('mtg', 9)]);
    // reg(8) → mtg(9) → then the 09:00 match, so both bars lead.
    expect(slices.map((s) => s.type)).toEqual(['bar', 'bar', 'segment']);
  });

  it('is a single segment when there are no bars', () => {
    const slices = partitionAtBars([item('a', 1), item('b', 2)], []);
    expect(slices).toHaveLength(1);
    expect(slices[0]!.type).toBe('segment');
  });
});
