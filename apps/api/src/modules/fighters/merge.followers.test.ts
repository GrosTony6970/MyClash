/**
 * A merge that leaves the surviving profile "off" removes its followers (operator ruling 212).
 *
 * An admin merges a duplicate Léa (people may follow her) into her real profile (they may not).
 * The merge keeps the stricter choice, and moves the duplicate's roster rows and its place in
 * each "Following" tab onto the survivor (migration 0212). So Marc, who followed the duplicate,
 * followed a person who had said no, and was told before her bouts. Now the survivor's followers
 * go when it ends "off", with their waiting alerts. A merge revert does not bring them back.
 *
 * The merge is one database call that cannot be run again, so the removal is best effort: a
 * failure is logged, and the merge answers done.
 */
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
  writesTo,
  type SupabaseRow,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { FighterMergeService } from './merge.service';

const profile = (id: string, allow: boolean) => ({
  id,
  display_name: `Lea ${id}`,
  email: null,
  date_of_birth: null,
  merged_into_id: null,
  deleted_at: null,
  allow_being_followed: allow,
});
const rosterRow = (id: string, profileId: string, status: string) => ({
  id,
  global_person_id: profileId,
  events: { status },
});
const follow = (person: string, user: string | null) => ({
  followed_person_id: person,
  follower_user_id: user,
});

const FOLLOWS = {
  rows: [
    follow('tom-spring', 'marc'),
    follow('lea-spring', 'marc'),
    follow('lea-spring', null),
    follow('lea-spring', 'nina'),
    follow('lea-past', 'nina'),
  ],
};

interface Choice {
  duplicate: boolean;
  survivor: boolean;
  /** What the function leaves on the survivor, when it is not the stricter of the two. */
  saved?: boolean;
}

/**
 * The merge as the function does it (0212): the duplicate's roster rows move to the survivor,
 * which keeps the stricter choice. It puts NEW rows in the lists: a row the service read before
 * keeps its old values, as a snapshot read before a database write does.
 */
function mergeRows(profiles: SupabaseRow[], roster: SupabaseRow[], choice: Choice): void {
  roster.forEach((row, at) => {
    if (row['global_person_id'] === 'duplicate') {
      roster[at] = { ...row, global_person_id: 'survivor' };
    }
  });
  profiles[1] = {
    ...profiles[1],
    allow_being_followed: choice.saved ?? (choice.survivor && choice.duplicate),
  };
}

/**
 * The tables BEFORE the merge. The double reads these lists when a query runs, so what the
 * service reads after the call is the merged state.
 */
function build(choice: Choice, overrides: Record<string, TableSeed> = {}) {
  const profiles: SupabaseRow[] = [
    profile('duplicate', choice.duplicate),
    profile('survivor', choice.survivor),
    profile('tom', true),
  ];
  const roster: SupabaseRow[] = [
    rosterRow('tom-spring', 'tom', 'published'),
    rosterRow('lea-spring', 'duplicate', 'published'),
    rosterRow('lea-past', 'survivor', 'completed'),
  ];
  const db = mockSupabase({
    global_persons: { rows: profiles },
    persons: { rows: roster },
    follows: FOLLOWS,
    directory_follows: { rows: [] },
    ...overrides,
  });
  // What had been written when the function was called: nothing may go before the merge.
  const writesAtMerge: number[] = [];
  const rpc = vi.fn(
    async (_name: string, _args: unknown): Promise<{ data: unknown; error: unknown }> => {
      writesAtMerge.push(db.writes.length);
      mergeRows(profiles, roster, choice);
      return { data: { persons: 1, workshopInstructors: 0 }, error: null };
    },
  );
  const applyFollow = vi.fn(async (_person: string, _follower: string) => undefined);
  const service = new FighterMergeService(
    { service: { from: db.from, rpc } } as never,
    { applyFollow } as never,
  );
  const merge = () => service.merge({ sourceId: 'duplicate', targetId: 'survivor' }, 'admin');
  return { db, rpc, applyFollow, writesAtMerge, merge };
}

/** The ruling's story: the duplicate may be followed, the real profile may not. */
const DUPLICATE_ON = { duplicate: true, survivor: false };
/** The other way round: the real profile may be followed until the merge, the duplicate may not. */
const SURVIVOR_ON = { duplicate: false, survivor: true };
const BOTH_ON = { duplicate: true, survivor: true };

const MERGED = {
  merged: true,
  sourceId: 'duplicate',
  targetId: 'survivor',
  moved: { persons: 1, workshopInstructors: 0 },
};
/** Her roster rows once merged: the one that moved, and the survivor's own. */
const HERS = [{ method: 'in', args: ['followed_person_id', ['lea-spring', 'lea-past']] }];
const errors = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((call) => String(call[0]));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a merge that leaves the survivor "off" removes its followers (ruling 212)', () => {
  it.each([
    ['the duplicate could be followed, the survivor not', DUPLICATE_ON],
    ['the survivor could be followed until the merge, the duplicate not', SURVIVOR_ON],
  ])(
    'removes the follows on the survivor and its place in each "Following" tab: %s',
    async (_, choice) => {
      const { db, writesAtMerge, merge } = build(choice);

      await expect(merge()).resolves.toEqual(MERGED);

      // The follows on the roster row the merge just moved, and on the survivor's own.
      expect(writesTo(db, 'follows')).toMatchObject([
        { op: 'update', filters: HERS },
        { op: 'delete', filters: HERS },
      ]);
      expect(writesTo(db, 'directory_follows')).toMatchObject([
        {
          op: 'delete',
          filters: [{ method: 'eq', args: ['followed_global_person_id', 'survivor'] }],
        },
      ]);
      // After the merge, never before: the function moves the follows this removes.
      expect(writesAtMerge).toEqual([0]);
    },
  );

  it("removes each account's waiting alerts about her, in the Events that are not over", async () => {
    const { applyFollow, merge } = build(DUPLICATE_ON);

    await merge();

    expect(applyFollow.mock.calls).toEqual([
      ['lea-spring', 'marc'],
      ['lea-spring', 'nina'],
    ]);
  });

  it('goes by the choice as saved, not by the two profiles read before the merge', async () => {
    // Both profiles said yes when they were read for the record; she saved "off" since.
    const { db, merge } = build({ duplicate: true, survivor: true, saved: false });

    await merge();

    expect(writesTo(db, 'follows').map((write) => write.op)).toEqual(['update', 'delete']);
  });

  it('reads the choice of the survivor once merged, by a column the table has', async () => {
    const { db, rpc, merge } = build(SURVIVOR_ON);
    const readsAtMerge: number[] = [];
    rpc.mockImplementationOnce(async () => {
      readsAtMerge.push(queriedTables(db.from).length);
      return { data: { persons: 1, workshopInstructors: 0 }, error: null };
    });

    await merge();

    expect(selectsFor(db.from, 'global_persons')).toEqual(['*', '*', 'allow_being_followed']);
    expect(filtersFor(db.from, 'global_persons', 'eq').at(-1)).toEqual(['id', 'survivor']);
    // The two profile reads come before the function, the choice after it.
    expect(readsAtMerge).toEqual([2]);
  });

  it('keeps the followers when both profiles may be followed', async () => {
    const { db, applyFollow, merge } = build(BOTH_ON);

    await expect(merge()).resolves.toEqual(MERGED);

    expect(queriedTables(db.from)).toEqual(['global_persons', 'global_persons', 'global_persons']);
    expect(db.writes).toEqual([]);
    expect(applyFollow).not.toHaveBeenCalled();
  });

  it('removes nothing when the merge is refused', async () => {
    const { db, rpc, merge } = build(DUPLICATE_ON);
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'Source fighter is already merged into another profile' },
    });

    await expect(merge()).rejects.toThrow('Source fighter is already merged into another profile');

    expect(queriedTables(db.from)).toEqual(['global_persons', 'global_persons']);
    expect(db.writes).toEqual([]);
  });
});

describe('the merge is done, whatever happens to the removal', () => {
  const BOOM = { data: null, error: { message: 'boom' } };

  it('removes the follows all the same when an alert step fails, and logs it', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { db, applyFollow, merge } = build(DUPLICATE_ON);
    applyFollow.mockRejectedValueOnce(new Error('queue down'));

    await expect(merge()).resolves.toEqual(MERGED);

    // The next follower still has his turn, and the follows go: with its follow gone, an alert
    // left behind does not ring.
    expect(applyFollow.mock.calls).toEqual([
      ['lea-spring', 'marc'],
      ['lea-spring', 'nina'],
    ]);
    expect(writesTo(db, 'follows').map((write) => write.op)).toEqual(['update', 'delete']);
    expect(writesTo(db, 'directory_follows')).toHaveLength(1);
    expect(errors(error)).toEqual([
      'Merge: the alerts of follower marc about lea-spring were not brought in line: queue down',
    ]);
  });

  it('answers done and logs it when the followers cannot be read: they stay', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { db, applyFollow, merge } = build(DUPLICATE_ON, { follows: BOOM });

    await expect(merge()).resolves.toEqual(MERGED);

    expect(db.writes).toEqual([]);
    expect(applyFollow).not.toHaveBeenCalled();
    expect(errors(error)).toEqual([
      'Merge into survivor is done, but the removal of its followers failed: followers read ' +
        'failed: boom',
    ]);
  });

  it('answers done and logs it when the choice of the survivor cannot be read', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const whole = { data: profile('any', false), error: null };
    const { db, merge } = build(DUPLICATE_ON, { global_persons: [whole, whole, BOOM] });

    await expect(merge()).resolves.toEqual(MERGED);

    expect(db.writes).toEqual([]);
    expect(errors(error)).toEqual([
      'Merge into survivor is done, but the removal of its followers failed: survivor choice ' +
        'read failed: boom',
    ]);
  });
});
