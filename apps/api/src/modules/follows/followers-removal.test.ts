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
const hubFollow = (follower: string, profile: string, on: boolean) => ({
  follower_user_id: follower,
  followed_global_person_id: profile,
  notify_referee_start: on,
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
    // From the People hub: Marc's switch "notify when refereeing" is on, Nina's is off; Zoé
    // follows Tom, not her.
    directory_follows: {
      rows: [
        hubFollow('marc', 'gp-lea', true),
        hubFollow('nina', 'gp-lea', false),
        hubFollow('zoe', 'gp-tom', true),
      ],
    },
  };
}

function build(overrides: Record<string, TableSeed> = {}) {
  const supabase = mockSupabase({ ...tables(), ...overrides });
  // How many writes `follows` had when an alert was asked for: after the mute, before the delete.
  const followWritesWhenAsked: number[] = [];
  const applyFollow = vi.fn(async (_person: string, _follower: string) => {
    followWritesWhenAsked.push(writesTo(supabase, 'follows').length);
  });
  // What had been written when the hub followers' duty alerts were asked for.
  const writtenAtHub: Array<[string, string]> = [];
  const applyHubFollow = vi.fn(async (_profile: string, _followers: readonly string[]) => {
    writtenAtHub.push(...supabase.writes.map((w): [string, string] => [w.table, w.op]));
  });
  const alerts = { applyFollow, applyHubFollow };
  const run = () => removeFollowersOf({ supabase: supabase as never, alerts }, LEA);
  return { supabase, applyFollow, applyHubFollow, writtenAtHub, followWritesWhenAsked, run };
}
const NO_ALERTS = () => ({ applyFollow: vi.fn(), applyHubFollow: vi.fn() });
const OF_LEA = { method: 'eq', args: ['followed_global_person_id', 'gp-lea'] };

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
    expect(writesTo(supabase, 'directory_follows').at(-1)).toMatchObject({
      op: 'delete',
      filters: [OF_LEA],
    });
  });

  it('turns the hub switches that are on off FIRST, then removes their duty alerts (ruling 217)', async () => {
    const { supabase, applyHubFollow, writtenAtHub, run } = build();

    await run();

    expect(writesTo(supabase, 'directory_follows')).toMatchObject([
      {
        op: 'update',
        row: { notify_referee_start: false },
        filters: [OF_LEA, { method: 'eq', args: ['notify_referee_start', true] }],
      },
      { op: 'delete' },
    ]);
    // Marc alone: Nina's switch was off, so no hub follow of hers set an alert; Zoé follows Tom.
    expect(applyHubFollow.mock.calls).toEqual([['gp-lea', ['marc']]]);
    // Every follow is muted and the Event follows are gone by then; the hub follows go last.
    expect(writtenAtHub).toEqual([
      ['directory_follows', 'update'],
      ['follows', 'update'],
      ['follows', 'delete'],
    ]);
    expect(supabase.writes.at(0)).toMatchObject({ table: 'directory_follows', op: 'update' });
    expect(supabase.writes.at(-1)).toMatchObject({ table: 'directory_follows', op: 'delete' });
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
    // The mute hands back whose switches it turned off: PostgREST returns no row unless asked.
    expect(selectsFor(supabase.from, 'directory_follows')).toEqual(['follower_user_id']);
  });

  it('writes nothing to the follows when nobody follows her', async () => {
    const { supabase, applyFollow, run } = build({ follows: { rows: [FOLLOWS.at(-1)!] } });

    await run();

    expect(writesTo(supabase, 'follows')).toEqual([]);
    expect(applyFollow).not.toHaveBeenCalled();
    expect(writesTo(supabase, 'directory_follows').map((write) => write.op)).toEqual([
      'update',
      'delete',
    ]);
  });

  it.each([
    ['no profile', 'u-nobody'],
    ['only a profile merged into another', 'u-merged'],
  ])('does nothing for an account that holds %s', async (_, account) => {
    const supabase = mockSupabase(tables());

    await removeFollowersOf({ supabase: supabase as never, alerts: NO_ALERTS() }, account);

    expect(queriedTables(supabase.from)).toEqual(['global_persons']);
    expect(supabase.writes).toEqual([]);
  });

  it('removes the followers of a profile by its id, whoever holds it (the door of a merge)', async () => {
    const supabase = mockSupabase(tables());
    const { applyFollow, applyHubFollow } = NO_ALERTS();

    // Tom's profile, asked by id: no account is looked up.
    await removeFollowersOfProfile(
      { supabase: supabase as never, alerts: { applyFollow, applyHubFollow } },
      'gp-tom',
    );

    expect(queriedTables(supabase.from)).not.toContain('global_persons');
    const his = [{ method: 'in', args: ['followed_person_id', ['tom-spring']] }];
    expect(writesTo(supabase, 'follows')).toMatchObject([
      { op: 'update', filters: his },
      { op: 'delete', filters: his },
    ]);
    expect(applyFollow.mock.calls).toEqual([['tom-spring', 'marc']]);
    expect(applyHubFollow.mock.calls).toEqual([['gp-tom', ['zoe']]]);
    expect(writesTo(supabase, 'directory_follows').at(-1)).toMatchObject({
      op: 'delete',
      filters: [{ method: 'eq', args: ['followed_global_person_id', 'gp-tom'] }],
    });
  });
});

describe('a second tap repairs a first that failed', () => {
  it('keeps the follows when an alert cannot be removed, and removes them the next time', async () => {
    const { supabase, applyFollow, run } = build();
    applyFollow.mockRejectedValueOnce(new Error('Followed person unreadable: boom'));

    await expect(run()).rejects.toThrow('Followed person unreadable: boom');
    // Muted, not deleted: the rows still say whose alerts are left to remove.
    expect(writesTo(supabase, 'follows').map((write) => write.op)).toEqual(['update']);
    expect(writesTo(supabase, 'directory_follows').map((write) => write.op)).toEqual(['update']);

    await run();
    expect(writesTo(supabase, 'follows').map((write) => write.op)).toEqual([
      'update',
      'update',
      'delete',
    ]);
    expect(writesTo(supabase, 'directory_follows').map((write) => write.op)).toEqual([
      'update',
      'update',
      'delete',
    ]);
  });

  it('keeps the hub follows when their duty alerts cannot be removed', async () => {
    const { supabase, applyHubFollow, run } = build();
    applyHubFollow.mockRejectedValueOnce(
      new Error('Duties of a followed referee unreadable: boom'),
    );

    await expect(run()).rejects.toThrow('Duties of a followed referee unreadable: boom');

    expect(writesTo(supabase, 'directory_follows').map((write) => write.op)).toEqual(['update']);
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
    ['the hub mute', { directory_follows: BOOM }, 'directory followers mute failed: boom'],
    [
      'the directory delete',
      { directory_follows: [{ data: [], error: null }, BOOM] },
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
