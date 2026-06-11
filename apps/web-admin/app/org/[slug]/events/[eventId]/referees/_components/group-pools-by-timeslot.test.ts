import { describe, expect, it } from 'vitest';
import { groupPoolsByTimeslot } from './group-pools-by-timeslot';

const pool = (id: string, scheduledStart: string | null) => ({ id, scheduledStart });

describe('groupPoolsByTimeslot', () => {
  it('groups pools sharing a start time and orders blocks chronologically', () => {
    const { blocks } = groupPoolsByTimeslot([
      pool('p1', '2027-06-22T11:00:00Z'),
      pool('final', '2027-06-22T09:40:00Z'),
      pool('p2', '2027-06-22T11:00:00Z'),
    ]);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.startTime).toBe('2027-06-22T09:40:00Z');
    expect(blocks[0]!.pools.map((p) => p.id)).toEqual(['final']);
    expect(blocks[1]!.pools.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('merges starts within 5 minutes into one block but not beyond', () => {
    const close = groupPoolsByTimeslot([
      pool('a', '2027-06-22T11:00:00Z'),
      pool('b', '2027-06-22T11:03:00Z'),
    ]);
    expect(close.blocks).toHaveLength(1);

    const apart = groupPoolsByTimeslot([
      pool('a', '2027-06-22T11:00:00Z'),
      pool('b', '2027-06-22T11:06:00Z'),
    ]);
    expect(apart.blocks).toHaveLength(2);
  });

  it('routes pools without a start time into unscheduled, preserving input order', () => {
    const { blocks, unscheduled } = groupPoolsByTimeslot([
      pool('u2', null),
      pool('s1', '2027-06-22T11:00:00Z'),
      pool('u1', null),
    ]);
    expect(blocks).toHaveLength(1);
    expect(unscheduled.map((p) => p.id)).toEqual(['u2', 'u1']);
  });
});
