import { describe, expect, it } from 'vitest';
import { buildScheduleBlocks, type BlockMatchInput } from './schedule-blocks';

/** A test bout length. Every input carries its own; the builder has no default. */
const BOUT_MINUTES = 5;

function poolMatch(
  id: string,
  startIso: string | null,
  liceId: string | null,
  n = 1,
  opts: { poolId?: string; poolName?: string; durationMinutes?: number } = {},
): BlockMatchInput {
  const { poolId = 'pool-1', poolName = 'Pool 1', durationMinutes = BOUT_MINUTES } = opts;
  return {
    id,
    liceId,
    scheduledAt: startIso,
    poolId,
    poolName,
    roundCode: `LSW-P1-M${n}`,
    phaseType: 'pool',
    tournamentName: 'Longsword Open',
    redFighterName: `Red ${n}`,
    blueFighterName: `Blue ${n}`,
    durationMinutes,
  };
}

function qfMatch(id: string, startIso: string, liceId: string, n: number): BlockMatchInput {
  return {
    id,
    liceId,
    scheduledAt: startIso,
    poolId: null,
    poolName: null,
    roundCode: `LSW-B-QF-M${n}`,
    phaseType: 'single_elim',
    tournamentName: 'Longsword Open',
    redFighterName: 'X',
    blueFighterName: 'Y',
    durationMinutes: BOUT_MINUTES,
  };
}

describe('buildScheduleBlocks', () => {
  it('groups a pool’s matches on a lice into one block, sorted', () => {
    const blocks = buildScheduleBlocks([
      poolMatch('b', '2027-06-21T09:03:00.000Z', 'lice-1', 2),
      poolMatch('a', '2027-06-21T09:00:00.000Z', 'lice-1', 1),
    ]);
    expect(blocks).toHaveLength(1);
    const blk = blocks[0]!;
    expect(blk.kind).toBe('pool');
    expect(blk.label).toBe('Pool 1');
    expect(blk.liceIds).toEqual(['lice-1']);
    expect(blk.startIso).toBe('2027-06-21T09:00:00.000Z');
    expect(blk.matchCount).toBe(2);
    expect(blk.matches.map((m) => m.id)).toEqual(['a', 'b']); // sorted by start
    expect(blk.matches[0]).toMatchObject({
      code: 'LSW-P1-M1',
      liceId: 'lice-1',
      startIso: '2027-06-21T09:00:00.000Z',
      redFighterName: 'Red 1',
      blueFighterName: 'Blue 1',
    });
  });

  it('ends at the last fight, never padded to a round boundary', () => {
    // 22 matches every 5 min from 09:00 → last starts 10:45 and runs its own 5 min.
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
    expect(blk.endIso).toBe('2027-06-21T10:50:00.000Z');
  });

  it('ends a block at its matches’ own lengths', () => {
    const blk = buildScheduleBlocks([
      poolMatch('a', '2027-06-21T09:00:00.000Z', 'lice-1', 1, { durationMinutes: 8 }),
      poolMatch('b', '2027-06-21T09:08:00.000Z', 'lice-1', 2, { durationMinutes: 8 }),
    ])[0]!;
    expect(blk.startIso).toBe('2027-06-21T09:00:00.000Z');
    expect(blk.endIso).toBe('2027-06-21T09:16:00.000Z'); // 09:08 + 8 min
  });

  it('a single-match block spans exactly its own bout', () => {
    const blk = buildScheduleBlocks([
      poolMatch('a', '2027-06-21T09:00:00.000Z', 'lice-1', 1, { durationMinutes: 8 }),
    ])[0]!;
    expect(blk.endIso).toBe('2027-06-21T09:08:00.000Z');
  });

  it('refuses a match with no usable length instead of inventing one', () => {
    // The median-gap and 5-minute fallbacks are gone. A builder that grew one
    // back would draw this block instead of throwing.
    expect(() =>
      buildScheduleBlocks([
        poolMatch('a', '2027-06-21T09:00:00.000Z', 'lice-1', 1, { durationMinutes: 0 }),
      ]),
    ).toThrow(RangeError);
  });

  it('ends at the latest END when a longer bout comes earlier (the hull, ADR-017)', () => {
    // 09:00 for 30 min, then 09:05 for 5 min. The last START ends at 09:10, but
    // the run is on the Lice until 09:30.
    const blk = buildScheduleBlocks([
      poolMatch('a', '2027-06-21T09:00:00.000Z', 'lice-1', 1, { durationMinutes: 30 }),
      poolMatch('b', '2027-06-21T09:05:00.000Z', 'lice-1', 2, { durationMinutes: 5 }),
    ])[0]!;
    expect(blk.startIso).toBe('2027-06-21T09:00:00.000Z');
    expect(blk.endIso).toBe('2027-06-21T09:30:00.000Z');
  });

  it('labels bracket rounds from the round code (single lice)', () => {
    const blocks = buildScheduleBlocks([qfMatch('q1', '2027-06-21T14:00:00.000Z', 'lice-2', 1)]);
    expect(blocks[0]!.kind).toBe('bracket');
    expect(blocks[0]!.label).toBe('Quarter-finals');
    expect(blocks[0]!.liceIds).toEqual(['lice-2']);
  });

  it('excludes unscheduled matches (no lice or no time)', () => {
    expect(buildScheduleBlocks([poolMatch('a', null, 'lice-1')])).toHaveLength(0);
    expect(buildScheduleBlocks([poolMatch('a', '2027-06-21T09:00:00.000Z', null)])).toHaveLength(0);
  });

  it('a pool fanned across two lices is ONE block spanning both', () => {
    const blocks = buildScheduleBlocks([
      poolMatch('a', '2027-06-21T09:00:00.000Z', 'lice-1', 1),
      poolMatch('b', '2027-06-21T09:00:00.000Z', 'lice-2', 2),
    ]);
    expect(blocks).toHaveLength(1);
    expect(new Set(blocks[0]!.liceIds)).toEqual(new Set(['lice-1', 'lice-2']));
  });

  it('a bracket round fanned across three lices is ONE block, liceIds length 3', () => {
    const blocks = buildScheduleBlocks([
      qfMatch('q1', '2027-06-21T14:00:00.000Z', 'lice-1', 1),
      qfMatch('q2', '2027-06-21T14:00:00.000Z', 'lice-2', 2),
      qfMatch('q3', '2027-06-21T14:00:00.000Z', 'lice-3', 3),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('bracket');
    expect(blocks[0]!.liceIds).toHaveLength(3);
    expect(new Set(blocks[0]!.liceIds)).toEqual(new Set(['lice-1', 'lice-2', 'lice-3']));
  });

  it('two different pools on the same lice at different times stay two blocks', () => {
    const blocks = buildScheduleBlocks([
      poolMatch('a', '2027-06-21T09:00:00.000Z', 'lice-1', 1, {
        poolId: 'pool-1',
        poolName: 'Pool 1',
      }),
      poolMatch('b', '2027-06-21T11:00:00.000Z', 'lice-1', 1, {
        poolId: 'pool-2',
        poolName: 'Pool 2',
      }),
    ]);
    expect(blocks).toHaveLength(2);
    for (const blk of blocks) expect(blk.liceIds).toEqual(['lice-1']);
    expect(blocks.map((b) => b.label).sort()).toEqual(['Pool 1', 'Pool 2']);
  });

  it('carries durationMinutes + liceId onto each block match', () => {
    const blk = buildScheduleBlocks([
      poolMatch('a', '2027-06-21T09:00:00.000Z', 'lice-1', 1, { durationMinutes: 7 }),
    ])[0]!;
    expect(blk.matches[0]).toMatchObject({ id: 'a', liceId: 'lice-1', durationMinutes: 7 });
  });

  it('carries an optional tournamentSlug onto the block (null when omitted)', () => {
    const withSlug = buildScheduleBlocks([
      {
        ...poolMatch('a', '2027-06-21T09:00:00.000Z', 'lice-1', 1),
        tournamentSlug: 'longsword-open',
      },
    ])[0]!;
    expect(withSlug.tournamentSlug).toBe('longsword-open');
    const withoutSlug = buildScheduleBlocks([
      poolMatch('a', '2027-06-21T09:00:00.000Z', 'lice-1', 1),
    ])[0]!;
    expect(withoutSlug.tournamentSlug).toBeNull();
  });
});
