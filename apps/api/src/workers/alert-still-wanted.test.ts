/**
 * A "starting soon" rings only if it is still WANTED when it fires (operator ruling 213).
 *
 * An alert is queued when a time is set, and removed or set again when a follow or a booking
 * changes. Each of those steps has a gap: Marc unfollows Léa at the second an organiser moves her
 * bout, and his alert is written back after it was removed; a booking is cancelled while the queue
 * is down, and its alert stays. So the saved rows are read once more when the alert fires.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  queriedTables,
  selectsFor,
  type TableSeed,
} from '../common/testing/supabase-chain';
import {
  follow,
  follows,
  hubFollow,
  hubFollows,
  rosterRow,
  seat,
  tables,
} from './alert-still-wanted.fixtures';
import { isStillWanted } from './alert-still-wanted';
import type { NotificationKind } from './notification-scheduler.worker';

function wanted(
  kind: NotificationKind,
  entityId: string,
  userId: string,
  overrides: Record<string, TableSeed> = {},
) {
  const db = mockSupabase({ ...tables(), ...overrides });
  return { db, answer: isStillWanted(db as never, { kind, entityId, userId }) };
}
const BOOM = { data: null, error: { message: 'boom' } };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a follower's bout alert rings only for a saved follow that wants it (ruling 213)", () => {
  it('rings for Marc, who follows Léa with the bout switch on', async () => {
    await expect(wanted('follow_match_starting', 'bout-1', 'marc').answer).resolves.toBe(true);
  });

  it('rings when he follows her opponent instead', async () => {
    const { answer } = wanted(
      'follow_match_starting',
      'bout-1',
      'marc',
      follows(follow('marc', 'tom')),
    );
    await expect(answer).resolves.toBe(true);
  });

  it.each<[string, string, string, Record<string, TableSeed>]>([
    ['he unfollowed her', 'bout-1', 'marc', follows()],
    [
      'he turned the bout switch off',
      'bout-1',
      'marc',
      follows(follow('marc', 'lea', { notify_match_start: false })),
    ],
    ['he follows nobody in that bout', 'bout-2', 'marc', {}],
    ["the follow is another follower's", 'bout-2', 'marc', follows(follow('nina', 'zoe'))],
    ['the bout is gone', 'bout-gone', 'marc', {}],
  ])('stays silent when %s', async (_, boutId, user, overrides) => {
    await expect(wanted('follow_match_starting', boutId, user, overrides).answer).resolves.toBe(
      false,
    );
  });
});

describe("a follower's duty alert", () => {
  it('rings for Marc, who follows Léa with the referee switch on', async () => {
    await expect(wanted('follow_referee_starting', 'duty-1', 'marc').answer).resolves.toBe(true);
  });

  it.each<[string, string, Record<string, TableSeed>]>([
    [
      'he turned the referee switch off',
      'duty-1',
      follows(follow('marc', 'lea', { notify_referee_start: false })),
    ],
    ['he follows her in another Event only', 'duty-1', follows(follow('marc', 'lea-elsewhere'))],
    ['he follows another person of the Event', 'duty-1', follows(follow('marc', 'tom'))],
    ['the duty is gone', 'duty-gone', {}],
  ])('stays silent when %s', async (_, dutyId, overrides) => {
    const { answer } = wanted('follow_referee_starting', dutyId, 'marc', overrides);
    await expect(answer).resolves.toBe(false);
  });
});

describe("a hub follower's duty alert (ruling 217)", () => {
  it('rings for Marc, whose hub switch is on, before a duty of a referee with no roster row', async () => {
    const hub = hubFollows(hubFollow('marc', 'gp-paul', true));
    await expect(
      wanted('follow_referee_starting', 'duty-of-paul', 'marc', hub).answer,
    ).resolves.toBe(true);
  });

  it.each<[string, string, Record<string, TableSeed>]>([
    ['his hub switch is off', 'duty-of-paul', hubFollows(hubFollow('marc', 'gp-paul', false))],
    ['he unfollowed him from the hub', 'duty-of-paul', hubFollows()],
    [
      "the hub follow is another follower's",
      'duty-of-paul',
      hubFollows(hubFollow('nina', 'gp-paul', true)),
    ],
    [
      'his hub follow is of another person',
      'duty-of-paul',
      hubFollows(hubFollow('marc', 'gp-lea', true)),
    ],
    [
      'he has an Event follow there with its switch off: that Event decides (217b)',
      'duty-1',
      {
        ...follows(follow('marc', 'lea', { notify_referee_start: false })),
        ...hubFollows(hubFollow('marc', 'gp-lea', true)),
      },
    ],
  ])('stays silent when %s', async (_, dutyId, overrides) => {
    const { answer } = wanted('follow_referee_starting', dutyId, 'marc', overrides);
    await expect(answer).resolves.toBe(false);
  });

  it.each<[string, string, boolean]>([
    ['nina', 'a member of the club that runs it', true],
    ['marc', 'not a member of that club', false],
  ])('in a TEST Event, %s, %s: rings = %s (ruling 217c)', async (user, _, rings) => {
    const hub = hubFollows(hubFollow('marc', 'gp-paul', true), hubFollow('nina', 'gp-paul', true));
    const { answer } = wanted('follow_referee_starting', 'duty-of-paul-test', user, hub);
    await expect(answer).resolves.toBe(rings);
  });

  it('rings when his only Event follow of her is in another Event', async () => {
    const { answer } = wanted('follow_referee_starting', 'duty-1', 'marc', {
      ...follows(follow('marc', 'lea-elsewhere', { notify_referee_start: false })),
      ...hubFollows(hubFollow('marc', 'gp-lea', true)),
    });
    await expect(answer).resolves.toBe(true);
  });
});

describe("a follower's Workshop alert", () => {
  it('rings for Marc, who follows the instructor with the Workshop switch on', async () => {
    await expect(wanted('follow_workshop_starting', 'session-1', 'marc').answer).resolves.toBe(
      true,
    );
  });

  it.each<[string, string, Record<string, TableSeed>]>([
    [
      'he turned the Workshop switch off',
      'session-1',
      follows(follow('marc', 'lea', { notify_workshop_start: false })),
    ],
    ['he follows the instructor of another Workshop', 'session-1', follows(follow('marc', 'tom'))],
    ['he follows her in another Event only', 'session-1', follows(follow('marc', 'lea-elsewhere'))],
    ['the session is gone', 'session-gone', {}],
  ])('stays silent when %s', async (_, sessionId, overrides) => {
    const { answer } = wanted('follow_workshop_starting', sessionId, 'marc', overrides);
    await expect(answer).resolves.toBe(false);
  });
});

describe('the alert of a booked Workshop rings only for a confirmed seat the account still holds', () => {
  it("rings for Léa's account: her roster row holds a confirmed seat", async () => {
    await expect(wanted('workshop_starting', 'session-1', 'u-lea').answer).resolves.toBe(true);
  });

  it.each<[string, string, Record<string, TableSeed>]>([
    ['the seat is on the waitlist', 'u-tom', {}],
    ['the booking was cancelled', 'u-lea', { workshop_enrollments: { rows: [] } }],
    ['the seat was refused', 'u-lea', { workshop_enrollments: { rows: [seat('lea', 'refused')] } }],
    [
      'the seat is in another session',
      'u-lea',
      { workshop_enrollments: { rows: [seat('lea', 'confirmed', 'session-2')] } },
    ],
    ['the account holds no roster row', 'u-nobody', {}],
    [
      'the roster row went to another account',
      'u-lea',
      { persons: { rows: [rosterRow('lea', 'gp-lea', 'event-1', 'u-other')] } },
    ],
  ])('stays silent when %s', async (_, user, overrides) => {
    const { answer } = wanted('workshop_starting', 'session-1', user, overrides);
    await expect(answer).resolves.toBe(false);
  });
});

describe("a Fighter's own bout alert rings only for the account that holds her roster row", () => {
  it('rings for Léa, and for Tom, who meet in the bout', async () => {
    await expect(wanted('match_starting', 'bout-1', 'u-lea').answer).resolves.toBe(true);
    await expect(wanted('match_starting', 'bout-1', 'u-tom').answer).resolves.toBe(true);
  });

  it.each<[string, string, string, Record<string, TableSeed>]>([
    ['the account holds no row of that bout', 'bout-1', 'u-zoe', {}],
    [
      'her roster row went to another account',
      'bout-1',
      'u-lea',
      { persons: { rows: [rosterRow('lea', 'gp-lea', 'event-1', 'u-other')] } },
    ],
    ['the bout is gone', 'bout-gone', 'u-lea', {}],
  ])('stays silent when %s', async (_, boutId, user, overrides) => {
    await expect(wanted('match_starting', boutId, user, overrides).answer).resolves.toBe(false);
  });
});

describe('what the check reads', () => {
  it.each<[NotificationKind, string, string, Record<string, string[]>]>([
    [
      'follow_match_starting',
      'bout-1',
      'marc',
      {
        matches: ['red_registration_id, blue_registration_id'],
        registrations: ['person_id'],
        follows: ['id'],
      },
    ],
    [
      'follow_referee_starting',
      'duty-1',
      'marc',
      {
        referee_assignments: ['person_id, event_id'],
        persons: ['id'],
        follows: ['follower_user_id, notify_referee_start'],
        directory_follows: ['follower_user_id'],
      },
    ],
    [
      'follow_workshop_starting',
      'session-1',
      'marc',
      {
        workshop_sessions: ['workshop_id, workshops ( event_id )'],
        workshop_instructors: ['global_person_id'],
        persons: ['id'],
        follows: ['id'],
      },
    ],
    ['workshop_starting', 'session-1', 'u-lea', { persons: ['id'], workshop_enrollments: ['id'] }],
    [
      'match_starting',
      'bout-1',
      'u-lea',
      {
        matches: ['red_registration_id, blue_registration_id'],
        registrations: ['person_id'],
        persons: ['id'],
      },
    ],
  ])('%s asks for columns the tables have', async (kind, entityId, user, selects) => {
    const { db, answer } = wanted(kind, entityId, user);

    await answer;

    expect(queriedTables(db.from).sort()).toEqual(Object.keys(selects).sort());
    for (const [table, expected] of Object.entries(selects)) {
      expect(selectsFor(db.from, table)).toEqual(expected);
    }
  });

  it.each<[NotificationKind]>([
    ['referee_starting'],
    ['assignment_changed'],
    ['workshop_cancelled'],
    ['waitlist_promoted'],
    ['results_published'],
    ['exchange_edit_rejected'],
    ['organizer_broadcast'],
    ['organizer_published_event'],
    ['swiss_round_published'],
  ])('%s is not checked: nothing is read', async (kind) => {
    const { db, answer } = wanted(kind, 'x', 'u-lea');

    await expect(answer).resolves.toBe(true);
    expect(queriedTables(db.from)).toEqual([]);
  });

  it.each<[NotificationKind, string, string, string, string]>([
    ['follow_match_starting', 'bout-1', 'marc', 'matches', 'alert bout'],
    ['follow_match_starting', 'bout-1', 'marc', 'registrations', 'alert bout entries'],
    ['follow_match_starting', 'bout-1', 'marc', 'follows', 'alert follows'],
    ['follow_referee_starting', 'duty-1', 'marc', 'referee_assignments', 'alert referee duty'],
    ['follow_referee_starting', 'duty-1', 'marc', 'persons', 'Roster rows of a referee'],
    ['follow_referee_starting', 'duty-1', 'marc', 'follows', 'Followers of a referee'],
    [
      'follow_referee_starting',
      'duty-1',
      'marc',
      'directory_follows',
      'Hub followers of a referee',
    ],
    [
      'follow_workshop_starting',
      'session-1',
      'marc',
      'workshop_sessions',
      'alert Workshop session',
    ],
    ['follow_workshop_starting', 'session-1', 'marc', 'workshop_instructors', 'alert instructors'],
    ['workshop_starting', 'session-1', 'u-lea', 'persons', 'alert roster rows'],
    ['workshop_starting', 'session-1', 'u-lea', 'workshop_enrollments', 'alert booking'],
    ['match_starting', 'bout-1', 'u-lea', 'persons', 'alert roster rows'],
  ])(
    '%s of %s for %s: a failed read of %s fails the job, it is not "not wanted"',
    async (kind, entityId, user, table, what) => {
      const { answer } = wanted(kind, entityId, user, { [table]: BOOM });

      const failure = await answer.then(
        () => null,
        (error: unknown) => error,
      );
      expect((failure as Error | null)?.constructor).toBe(Error);
      expect((failure as Error).message).toBe(`${what} read failed: boom`);
    },
  );
});
