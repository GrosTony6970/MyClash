import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, queriedTables, type TableSeed } from '../../common/testing/supabase-chain';
import { MatchAlertRefresherService } from './match-alert-refresher.service';

const bout = (id: string, poolId: string | null) => ({ id, pool_id: poolId });
const duty = (id: string, on: { pool?: string; bout?: string }, status = 'confirmed') => ({
  id,
  pool_id: on.pool ?? null,
  match_id: on.bout ?? null,
  status,
});

/**
 * Pool A holds 250 bouts, more than one piece of the bouts; the final is a bout of no Pool. Anna
 * is locked on Pool A, Paul on the final. The decoys: a duty on Pool B, one being planned on the
 * final.
 */
const POOL_A = Array.from({ length: 250 }, (_, n) => `a-${n}`);
const TABLES: Record<string, TableSeed> = {
  matches: { rows: [...POOL_A.map((id) => bout(id, 'pool-a')), bout('final', null)] },
  referee_assignments: {
    rows: [
      duty('anna-pool-a', { pool: 'pool-a' }),
      duty('zoe-pool-b', { pool: 'pool-b' }),
      duty('paul-final', { bout: 'final' }),
      duty('planned-final', { bout: 'final' }, 'assigned'),
    ],
  },
};
const BOOM = { data: null, error: { message: 'boom' } };

function makeRefresher(tables: Record<string, TableSeed> = TABLES) {
  const personal = {
    scheduleMatchStartingMany: vi.fn().mockResolvedValue(undefined),
    scheduleRefereeDutiesStarting: vi.fn().mockResolvedValue(undefined),
  };
  const follows = {
    scheduleMatchStartingMany: vi.fn().mockResolvedValue(undefined),
    scheduleRefereeDutiesStarting: vi.fn().mockResolvedValue(undefined),
  };
  const db = mockSupabase(tables);
  const refresher = new MatchAlertRefresherService(
    personal as never,
    follows as never,
    db as never,
  );
  return { refresher, personal, follows, db };
}

const sizes = (fn: { mock: { calls: unknown[][] } }) =>
  fn.mock.calls.map(([ids]) => (ids as string[]).length);
/** The duties one duty scheduler was handed, by id, per call. */
const handed = (fn: { mock: { calls: unknown[][] } }) =>
  fn.mock.calls.map(([duties]) => (duties as Array<{ id: string }>).map((d) => d.id).sort());

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MatchAlertRefresherService.refresh', () => {
  it('hands both families every bout, 200 at a time, each bout once', async () => {
    // A day cleared from the board names every bout of it; each family reads
    // its bouts by id in the URL, and a failed read there is swallowed — the
    // cleared bouts' alerts would stay queued with nothing said.
    const { refresher, personal, follows } = makeRefresher();
    const ids = Array.from({ length: 401 }, (_, n) => `m-${n}`);

    await refresher.refresh([...ids, 'm-7', '']);

    expect(sizes(personal.scheduleMatchStartingMany)).toEqual([200, 200, 1]);
    expect(sizes(follows.scheduleMatchStartingMany)).toEqual([200, 200, 1]);
    expect(personal.scheduleMatchStartingMany.mock.calls.flatMap(([chunk]) => chunk)).toEqual(ids);
    expect(follows.scheduleMatchStartingMany.mock.calls.flatMap(([chunk]) => chunk)).toEqual(ids);
  });

  it('asks nothing when no bout is named', async () => {
    const { refresher, personal, follows, db } = makeRefresher();

    await refresher.refresh(['', '']);

    expect(personal.scheduleMatchStartingMany).not.toHaveBeenCalled();
    expect(follows.scheduleMatchStartingMany).not.toHaveBeenCalled();
    expect(queriedTables(db.from)).toEqual([]);
    expect(personal.scheduleRefereeDutiesStarting).not.toHaveBeenCalled();
  });
});

describe('the duty family: the alerts of the locked duties the moved bouts start (ruling 221)', () => {
  it('hands both duty schedulers each locked duty of the bouts, once', async () => {
    const { refresher, personal, follows } = makeRefresher();

    // Pool A's bouts fall in two pieces of the bouts: Anna's Pool duty is found twice.
    await refresher.refresh([...POOL_A, 'final']);

    expect(handed(personal.scheduleRefereeDutiesStarting)).toEqual([['anna-pool-a', 'paul-final']]);
    expect(handed(follows.scheduleRefereeDutiesStarting)).toEqual([['anna-pool-a', 'paul-final']]);
  });

  it('hands the duties 200 at a time: their holders are read by id in the URL', async () => {
    // 201 bouts of no Pool, each with one locked duty.
    const bouts = Array.from({ length: 201 }, (_, n) => `f-${n}`);
    const { refresher, personal, follows } = makeRefresher({
      matches: { rows: bouts.map((id) => bout(id, null)) },
      referee_assignments: { rows: bouts.map((id) => duty(`duty-${id}`, { bout: id })) },
    });

    await refresher.refresh(bouts);

    const pieces = (fn: { mock: { calls: unknown[][] } }) =>
      fn.mock.calls.map(([duties]) => (duties as unknown[]).length);
    expect(pieces(personal.scheduleRefereeDutiesStarting)).toEqual([200, 1]);
    expect(pieces(follows.scheduleRefereeDutiesStarting)).toEqual([200, 1]);
  });

  it('serves the bout families first, then the duties, at one clock', async () => {
    const { refresher, personal, follows } = makeRefresher();

    await refresher.refresh(['final']);

    const [, own] = personal.scheduleRefereeDutiesStarting.mock.calls[0] ?? [];
    const [, theirs] = follows.scheduleRefereeDutiesStarting.mock.calls[0] ?? [];
    expect(own).toBeInstanceOf(Date);
    expect(theirs).toBe(own);
    expect(follows.scheduleMatchStartingMany.mock.invocationCallOrder[0]).toBeLessThan(
      personal.scheduleRefereeDutiesStarting.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('calls no duty scheduler when the bouts start no locked duty', async () => {
    const { refresher, personal, follows } = makeRefresher({
      ...TABLES,
      referee_assignments: { rows: [duty('planned-final', { bout: 'final' }, 'assigned')] },
    });

    await refresher.refresh(['final']);

    expect(personal.scheduleRefereeDutiesStarting).not.toHaveBeenCalled();
    expect(follows.scheduleRefereeDutiesStarting).not.toHaveBeenCalled();
  });

  it('says so, and still serves the bout families, when the duties cannot be read', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { refresher, personal, follows } = makeRefresher({
      ...TABLES,
      referee_assignments: BOOM,
    });

    await expect(refresher.refresh(['final'])).resolves.toBeUndefined();

    expect(warn.mock.calls).toEqual([
      [
        'The referee duties of the moved bouts are unreadable; their alerts stay as they were: duties on the moved bouts read failed: boom',
      ],
    ]);
    expect(sizes(personal.scheduleMatchStartingMany)).toEqual([1]);
    expect(sizes(follows.scheduleMatchStartingMany)).toEqual([1]);
    expect(personal.scheduleRefereeDutiesStarting).not.toHaveBeenCalled();
  });

  it.each<['personal' | 'follows', string]>([
    ['personal', "the referees' own"],
    ['follows', "their followers'"],
  ])(
    'a duty scheduler that throws (%s) fails no schedule write, and the other one still runs',
    async (thrower, whose) => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const made = makeRefresher();
      made[thrower].scheduleRefereeDutiesStarting.mockRejectedValue(new Error('job is locked'));

      await expect(made.refresher.refresh(['final'])).resolves.toBeUndefined();

      expect(warn.mock.calls).toEqual([
        [`The duty alerts of the moved bouts were not all set (${whose}): job is locked`],
      ]);
      expect(made.personal.scheduleRefereeDutiesStarting).toHaveBeenCalledTimes(1);
      expect(made.follows.scheduleRefereeDutiesStarting).toHaveBeenCalledTimes(1);
    },
  );
});
