/**
 * Her "people may follow me" switched off removes the people who already follow her (operator
 * ruling 208).
 *
 * Marc and Nina follow Léa in the Spring Open, a guest too; Nina follows her in a draft Event,
 * Marc followed her in last year's Cup and Nina in an archived one. She switches the choice off. They used to stay her followers: she stayed in their "Following"
 * tab and they were still told before her bouts.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  queriedTables,
  selectsFor,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { removeFollowersOf, removeFollowersOfProfile } from './followers-removal';

const LEA = 'u-lea';
const rosterRow = (id: string, profile: string, events: unknown) => ({
  id,
  global_person_id: profile,
  events,
});
const follow = (person: string, user: string | null) => ({
  followed_person_id: person,
  follower_user_id: user,
  follower_guest_session_id: user ? null : 'guest-1',
});
const HER_ROWS = ['lea-spring', 'lea-draft', 'lea-past', 'lea-archived'];
const FOLLOWS = [
  follow('lea-spring', 'marc'),
  follow('lea-spring', 'nina'),
  follow('lea-spring', null),
  follow('lea-draft', 'nina'),
  follow('lea-past', 'marc'),
  follow('lea-archived', 'nina'),
  // Tom's follower is not hers.
  follow('tom-spring', 'marc'),
];

function tables(): Record<string, TableSeed> {
  return {
    global_persons: {
      rows: [
        { id: 'gp-lea', claimed_by_user_id: LEA, merged_into_id: null },
        // A merge keeps an account on the merged-away profile when another account holds the
        // survivor (0212): that account has no live profile.
        { id: 'gp-old', claimed_by_user_id: 'u-merged', merged_into_id: 'gp-lea' },
        { id: 'gp-tom', claimed_by_user_id: 'u-tom', merged_into_id: null },
      ],
    },
    persons: {
      rows: [
        rosterRow('lea-spring', 'gp-lea', { status: 'published' }),
        rosterRow('lea-draft', 'gp-lea', { status: 'draft' }),
        rosterRow('lea-past', 'gp-lea', { status: 'completed' }),
        // The typed client hands a to-one embed as an array.
        rosterRow('lea-archived', 'gp-lea', [{ status: 'archived' }]),
        rosterRow('tom-spring', 'gp-tom', { status: 'published' }),
        // A roster row of the merged-away profile: its account has nothing to remove.
        rosterRow('old-spring', 'gp-old', { status: 'published' }),
      ],
    },
    follows: { rows: FOLLOWS },
    directory_follows: { rows: [] },
  };
}

function build(overrides: Record<string, TableSeed> = {}) {
  const supabase = mockSupabase({ ...tables(), ...overrides });
  // How many writes `follows` had when an alert was asked for: after the mute, before the delete.
  const followWritesWhenAsked: number[] = [];
  const applyFollow = vi.fn(async (_person: string, _follower: string) => {
    followWritesWhenAsked.push(writesTo(supabase, 'follows').length);
  });
  const run = () =>
    removeFollowersOf({ supabase: supabase as never, alerts: { applyFollow } }, LEA);
  return { supabase, applyFollow, followWritesWhenAsked, run };
}

const HERS = [{ method: 'in', args: ['followed_person_id', HER_ROWS] }];
const BOOM = { data: null, error: { message: 'boom' } };
const OK = { data: null, error: null };

describe('"people may follow me" switched off removes her followers (ruling 208)', () => {
  it('deletes the follows on her in every Event, and her place in each "Following" tab', async () => {
    const { supabase, run } = build();

    await run();

    const [mute, remove] = writesTo(supabase, 'follows');
    expect(remove).toMatchObject({ op: 'delete', filters: HERS });
    expect(mute).toMatchObject({
      op: 'update',
      row: {
        notify_match_start: false,
        notify_referee_start: false,
        notify_workshop_start: false,
      },
      filters: HERS,
    });
    expect(writesTo(supabase, 'follows')).toHaveLength(2);
    expect(writesTo(supabase, 'directory_follows')).toMatchObject([
      { op: 'delete', filters: [{ method: 'eq', args: ['followed_global_person_id', 'gp-lea'] }] },
    ]);
  });

  it("removes each account's waiting alerts about her, in the Events that are not over", async () => {
    const { applyFollow, followWritesWhenAsked, run } = build();

    await run();

    // Not the guest (no account to tell), not an Event that is over (nothing waits there), not
    // Tom's follower.
    expect(applyFollow.mock.calls).toEqual([
      ['lea-spring', 'marc'],
      ['lea-spring', 'nina'],
      ['lea-draft', 'nina'],
    ]);
    // Muted by then, so the scheduler sets none of hers again; not deleted yet, so a failure here
    // leaves the rows for the second tap.
    expect(followWritesWhenAsked).toEqual([1, 1, 1]);
  });

  it('reads her live profile, her roster rows and their followers by columns the tables have', async () => {
    const { supabase, run } = build();

    await run();

    expect(selectsFor(supabase.from, 'global_persons')).toEqual(['id']);
    expect(selectsFor(supabase.from, 'persons')).toEqual(['id, events ( status )']);
    expect(selectsFor(supabase.from, 'follows')).toEqual(['followed_person_id, follower_user_id']);
  });

  it('writes nothing to the follows when nobody follows her', async () => {
    const { supabase, applyFollow, run } = build({ follows: { rows: [FOLLOWS.at(-1)!] } });

    await run();

    expect(writesTo(supabase, 'follows')).toEqual([]);
    expect(applyFollow).not.toHaveBeenCalled();
    expect(writesTo(supabase, 'directory_follows')).toHaveLength(1);
  });

  it.each([
    ['no profile', 'u-nobody'],
    ['only a profile merged into another', 'u-merged'],
  ])('does nothing for an account that holds %s', async (_, account) => {
    const supabase = mockSupabase(tables());

    await removeFollowersOf(
      { supabase: supabase as never, alerts: { applyFollow: vi.fn() } },
      account,
    );

    expect(queriedTables(supabase.from)).toEqual(['global_persons']);
    expect(supabase.writes).toEqual([]);
  });

  it('removes the followers of a profile by its id, whoever holds it (the door of a merge)', async () => {
    const supabase = mockSupabase(tables());
    const applyFollow = vi.fn();

    // Tom's profile, asked by id: no account is looked up.
    await removeFollowersOfProfile(
      { supabase: supabase as never, alerts: { applyFollow } },
      'gp-tom',
    );

    expect(queriedTables(supabase.from)).not.toContain('global_persons');
    const his = [{ method: 'in', args: ['followed_person_id', ['tom-spring']] }];
    expect(writesTo(supabase, 'follows')).toMatchObject([
      { op: 'update', filters: his },
      { op: 'delete', filters: his },
    ]);
    expect(applyFollow.mock.calls).toEqual([['tom-spring', 'marc']]);
    expect(writesTo(supabase, 'directory_follows')).toMatchObject([
      { op: 'delete', filters: [{ method: 'eq', args: ['followed_global_person_id', 'gp-tom'] }] },
    ]);
  });
});

describe('a second tap repairs a first that failed', () => {
  it('keeps the follows when an alert cannot be removed, and removes them the next time', async () => {
    const { supabase, applyFollow, run } = build();
    applyFollow.mockRejectedValueOnce(new Error('Followed person unreadable: boom'));

    await expect(run()).rejects.toThrow('Followed person unreadable: boom');
    // Muted, not deleted: the rows still say whose alerts are left to remove.
    expect(writesTo(supabase, 'follows').map((write) => write.op)).toEqual(['update']);
    expect(writesTo(supabase, 'directory_follows')).toEqual([]);

    await run();
    expect(writesTo(supabase, 'follows').map((write) => write.op)).toEqual([
      'update',
      'update',
      'delete',
    ]);
    expect(writesTo(supabase, 'directory_follows')).toHaveLength(1);
  });

  it.each<[string, Record<string, TableSeed>, string]>([
    ['her profile', { global_persons: BOOM }, 'followed profile read failed: boom'],
    ['her roster rows', { persons: BOOM }, 'followed roster rows read failed: boom'],
    ['her followers', { follows: BOOM }, 'followers read failed: boom'],
    [
      'the mute',
      { follows: [{ data: FOLLOWS, error: null }, BOOM] },
      'followers mute failed: boom',
    ],
    [
      'the delete',
      { follows: [{ data: FOLLOWS, error: null }, OK, BOOM] },
      'followers delete failed: boom',
    ],
    [
      'the directory delete',
      { directory_follows: BOOM },
      'directory followers delete failed: boom',
    ],
  ])('a failed read or write of %s is a plain error, a 5xx', async (_, overrides, message) => {
    const { run } = build(overrides);

    const failure = await run().then(
      () => null,
      (error: unknown) => error,
    );

    expect((failure as Error | null)?.constructor).toBe(Error);
    expect((failure as Error).message).toBe(message);
  });
});
