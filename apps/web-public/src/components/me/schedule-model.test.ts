import { describe, expect, it } from 'vitest';
import {
  aggregateReferee,
  fightHeaderEnd,
  partitionAtBars,
  refereeAssignmentKey,
} from './schedule-model';
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
    swissRound: null,
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

  it('groups Swiss matches by ROUND, not into one bucket per tournament', () => {
    // The whole point: a referee working rounds 1 and 3 has two separate duties
    // at two separate times, and the old key collapsed them into one card.
    const r1a = slot({ matchId: '1', matchKind: 'swiss', swissRound: 1 });
    const r1b = slot({ matchId: '2', matchKind: 'swiss', swissRound: 1 });
    const r3 = slot({ matchId: '3', matchKind: 'swiss', swissRound: 3 });
    expect(refereeAssignmentKey(r1a)).toBe(refereeAssignmentKey(r1b));
    expect(refereeAssignmentKey(r1a)).not.toBe(refereeAssignmentKey(r3));
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
    // 8-minute bouts, given out of order: neither the first nor the last row holds
    // the earliest start or the latest end, and the latest start plus five minutes
    // is not the end either.
    const slots = [
      ['09:22', '09:30'],
      ['09:00', '09:08'],
      ['09:44', '09:52'],
      ['09:30', '09:38'],
    ].map(([start, end], i) =>
      slot({
        matchId: `m${i}`,
        matchKind: 'pool',
        poolId: 'p1',
        poolName: 'Pool 4',
        scheduledAt: `2027-05-22T${start}:00Z`,
        startsAt: `2027-05-22T${start}:00.000Z`,
        endsAt: `2027-05-22T${end}:00.000Z`,
        liceName: i === 1 ? 'Lice 4' : null,
      }),
    );
    const [agg] = aggregateReferee(slots);
    expect(agg).toBeDefined();
    expect(agg!.count).toBe(4);
    expect(agg!.poolName).toBe('Pool 4');
    // Representative lice is picked from whichever match carries one.
    expect(agg!.liceName).toBe('Lice 4');
    // Window spans the earliest start to the latest end the API sent.
    expect(agg!.startIso).toBe('2027-05-22T09:00:00.000Z');
    expect(agg!.endMs).toBe(new Date('2027-05-22T09:52:00Z').getTime());
  });

  it("keeps a placed duty's start, and gives it no end, when the API could not work its window out", () => {
    // A failed read of the duty's Matches answers null for both ends, while the
    // Match's own time still arrives: the card stays on its day instead of "TBD",
    // and no length is invented for its end.
    const [agg] = aggregateReferee([
      slot({ matchId: 'm1', matchKind: 'pool', poolId: 'p1', scheduledAt: '2027-05-22T10:00:00Z' }),
    ]);
    expect(agg!.startMs).toBe(Date.parse('2027-05-22T10:00:00Z'));
    expect(agg!.endMs).toBeNull();
  });

  it('derives a pool-scoped card window from the startsAt/endsAt the API works out', () => {
    // A pool "Déclarant" duty covers no single Match (scheduledAt null): its
    // window is the one the API works out from the Pool's placed Matches, so the
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

describe('fightHeaderEnd', () => {
  const BLOCK_END = Date.parse('2027-05-22T11:30:00Z');
  const bout = (hhmm: string, durationMinutes: number | null) => ({
    scheduledAt: `2027-05-22T${hhmm}:00Z`,
    durationMinutes,
  });

  it('ends at the block when the bout ends before it', () => {
    expect(fightHeaderEnd(bout('11:05', 5), BLOCK_END)).toBe(BLOCK_END);
  });

  it('ends at the bout when the bout was moved past its block', () => {
    expect(fightHeaderEnd(bout('11:40', 5), BLOCK_END)).toBe(Date.parse('2027-05-22T11:45:00Z'));
  });

  it("ends at the bout's own planned end when there is no block", () => {
    expect(fightHeaderEnd(bout('11:05', 8), null)).toBe(Date.parse('2027-05-22T11:13:00Z'));
  });

  it('counts a bout whose length is unknown as ending at its start', () => {
    expect(fightHeaderEnd(bout('11:40', null), BLOCK_END)).toBe(Date.parse('2027-05-22T11:40:00Z'));
    expect(fightHeaderEnd(bout('11:05', null), null)).toBe(Date.parse('2027-05-22T11:05:00Z'));
  });

  it('ends at the block for an unplaced bout, and nowhere without one', () => {
    expect(fightHeaderEnd({ scheduledAt: null, durationMinutes: 5 }, BLOCK_END)).toBe(BLOCK_END);
    expect(fightHeaderEnd({ scheduledAt: null, durationMinutes: 5 }, null)).toBeNull();
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
