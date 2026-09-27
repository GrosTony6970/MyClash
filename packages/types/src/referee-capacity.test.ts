import { describe, expect, it } from 'vitest';
import { ANY_AVAILABILITY } from './referee-availability';
import {
  detectConcurrencyShortage,
  type RefereeCommitmentPool,
  type RefereeForCapacity,
} from './referee-capacity';

function pool(over: Partial<RefereeCommitmentPool> & { id: string }): RefereeCommitmentPool {
  return {
    tournamentId: 't1',
    scheduledStart: null,
    scheduledEnd: null,
    roleSlotCount: 3,
    fighterPersonIds: [],
    ...over,
  };
}

const WIN = { scheduledStart: '2027-06-22T11:00:00Z', scheduledEnd: '2027-06-22T13:24:00Z' };

describe('detectConcurrencyShortage', () => {
  const threeParallel = [
    pool({ id: 'p1', ...WIN, roleSlotCount: 3 }),
    pool({ id: 'p2', ...WIN, roleSlotCount: 3 }),
    pool({ id: 'p3', ...WIN, roleSlotCount: 3 }),
  ];
  const refs = (n: number): RefereeForCapacity[] =>
    Array.from({ length: n }, (_, i) => ({
      personId: `r${i}`,
      roles: ['arbitre_table'],
      availability: ANY_AVAILABILITY,
    }));
  const day0 = () => '2027-06-22';

  it('warns when parallel pools need more slots than there are free referees', () => {
    const warnings = detectConcurrencyShortage(threeParallel, refs(6), day0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ needed: 9, free: 6, liceCount: 3 });
  });

  it('does not warn when enough referees are free', () => {
    expect(detectConcurrencyShortage(threeParallel, refs(12), day0)).toHaveLength(0);
  });

  it('counts a referee fighting in an active pool as not free', () => {
    const pools = [
      pool({ id: 'p1', ...WIN, roleSlotCount: 3 }),
      pool({ id: 'p2', ...WIN, roleSlotCount: 3, fighterPersonIds: ['r0', 'r1'] }),
    ];
    // 6 slots needed; 4 refs but 2 are fighting → only 2 free.
    const warnings = detectConcurrencyShortage(pools, refs(4), day0);
    expect(warnings[0]).toMatchObject({ needed: 6, free: 2 });
  });

  it("asks the checker's availability test: a referee who left before the window is not free", () => {
    // One Pool 11:00-13:24 needing 3; three referees, one of whom leaves at 12:00.
    const leavesAtNoon: RefereeForCapacity = {
      personId: 'r2',
      roles: [],
      availability: {
        tournamentIds: null,
        days: [
          {
            date: '2027-06-22',
            window: { startMs: Date.parse('2027-06-22T08:00:00Z'), endMs: Date.parse(WIN_NOON) },
          },
        ],
      },
    };
    const pools = [pool({ id: 'p1', ...WIN, roleSlotCount: 3 })];
    const warnings = detectConcurrencyShortage(pools, [...refs(2), leavesAtNoon], day0);
    expect(warnings).toEqual([
      { start: WIN.scheduledStart, end: WIN.scheduledEnd, liceCount: 1, needed: 3, free: 2 },
    ]);
    // Staying until the Pool ends makes three.
    const staysOn: RefereeForCapacity = {
      ...leavesAtNoon,
      availability: {
        tournamentIds: null,
        days: [
          {
            date: '2027-06-22',
            window: {
              startMs: Date.parse('2027-06-22T08:00:00Z'),
              endMs: Date.parse(WIN.scheduledEnd),
            },
          },
        ],
      },
    };
    expect(detectConcurrencyShortage(pools, [...refs(2), staysOn], day0)).toEqual([]);
  });

  it('counts a referee ticked for another day or another Tournament as not free', () => {
    const pools = [pool({ id: 'p1', ...WIN, roleSlotCount: 3 })];
    const otherDay: RefereeForCapacity = {
      personId: 'r2',
      roles: [],
      availability: {
        tournamentIds: null,
        days: [
          {
            date: '2027-06-23',
            window: {
              startMs: Date.parse('2027-06-23T00:00:00Z'),
              endMs: Date.parse('2027-06-24T00:00:00Z'),
            },
          },
        ],
      },
    };
    const otherTournament: RefereeForCapacity = {
      personId: 'r3',
      roles: [],
      availability: { tournamentIds: ['t2'], days: null },
    };
    const dates: string[] = [];
    const warnings = detectConcurrencyShortage(
      pools,
      [...refs(2), otherDay, otherTournament],
      (iso) => {
        dates.push(iso);
        return '2027-06-22';
      },
    );
    expect(warnings[0]).toMatchObject({ needed: 3, free: 2 });
    expect(dates).toEqual([WIN.scheduledStart]);
  });
});

const WIN_NOON = '2027-06-22T12:00:00Z';
