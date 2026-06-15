import { describe, expect, it } from 'vitest';
import { buildScheduleBlocks, type BlockMatchInput } from './schedule-blocks';

function poolMatch(
  id: string,
  startIso: string | null,
  liceId: string | null,
  n = 1,
): BlockMatchInput {
  return {
    id,
    liceId,
    scheduledAt: startIso,
    poolId: 'pool-1',
    poolName: 'Pool 1',
    roundCode: `LSW-P1-M${n}`,
    phaseType: 'pool',
    tournamentName: 'Longsword Open',
    redFighterName: `Red ${n}`,
    blueFighterName: `Blue ${n}`,
  };
}

describe('buildScheduleBlocks', () => {
  it('groups a pool’s matches on a lice into one block, sorted, with rounded end', () => {
    const blocks = buildScheduleBlocks([
      poolMatch('b', '2027-06-21T09:03:00.000Z', 'lice-1', 2),
      poolMatch('a', '2027-06-21T09:00:00.000Z', 'lice-1', 1),
    ]);
    expect(blocks).toHaveLength(1);
    const blk = blocks[0]!;
    expect(blk.kind).toBe('pool');
    expect(blk.label).toBe('Pool 1');
    expect(blk.liceId).toBe('lice-1');
    expect(blk.startIso).toBe('2027-06-21T09:00:00.000Z');
    expect(blk.matchCount).toBe(2);
    expect(blk.matches.map((m) => m.id)).toEqual(['a', 'b']); // sorted by start
    expect(blk.matches[0]).toMatchObject({
      code: 'LSW-P1-M1',
      startIso: '2027-06-21T09:00:00.000Z',
      redFighterName: 'Red 1',
      blueFighterName: 'Blue 1',
    });
  });

  it('rounds a ~1h45 pool up to a 2h block', () => {
    // 22 matches every 5 min from 09:00 → last at 10:45 (105 min span).
    const matches = Array.from({ length: 22 }, (_, i) =>
      poolMatch(
        `m${i}`,
        new Date(Date.parse('2027-06-21T09:00:00.000Z') + i * 5 * 60_000).toISOString(),
        'lice-1',
        i + 1,
      ),
    );
    const blk = buildScheduleBlocks(matches)[0]!;
    expect(blk.startIso).toBe('2027-06-21T09:00:00.000Z');
    expect(blk.endIso).toBe('2027-06-21T11:00:00.000Z'); // rounded up to 2h
  });

  it('labels bracket rounds from the round code', () => {
    const blocks = buildScheduleBlocks([
      {
        id: 'q1',
        liceId: 'lice-2',
        scheduledAt: '2027-06-21T14:00:00.000Z',
        poolId: null,
        poolName: null,
        roundCode: 'LSW-B-QF-M1',
        phaseType: 'single_elim',
        tournamentName: 'Longsword Open',
        redFighterName: 'X',
        blueFighterName: 'Y',
      } as BlockMatchInput,
    ]);
    expect(blocks[0]!.kind).toBe('bracket');
    expect(blocks[0]!.label).toBe('Quarter-finals');
  });

  it('excludes unscheduled matches (no lice or no time)', () => {
    expect(buildScheduleBlocks([poolMatch('a', null, 'lice-1')])).toHaveLength(0);
    expect(buildScheduleBlocks([poolMatch('a', '2027-06-21T09:00:00.000Z', null)])).toHaveLength(0);
  });

  it('splits a pool that runs on two lices into one block per lice', () => {
    const blocks = buildScheduleBlocks([
      poolMatch('a', '2027-06-21T09:00:00.000Z', 'lice-1', 1),
      poolMatch('b', '2027-06-21T09:00:00.000Z', 'lice-2', 2),
    ]);
    expect(blocks).toHaveLength(2);
    expect(new Set(blocks.map((b) => b.liceId))).toEqual(new Set(['lice-1', 'lice-2']));
  });
});
