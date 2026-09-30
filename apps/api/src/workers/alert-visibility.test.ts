/**
 * A "starting soon" fires only for what the public may see, checked when it fires. Léa fights in
 * the draft Winter Secret of the public Winter Games, and Marc referees one of its Pools. The
 * organiser planned the bouts before publishing it, so the alerts sit in the queue from then on:
 * Léa's own, Marc's own (rulings 183, 184), and those of Sam, who follows them both (rulings 129,
 * 130, 163; ruling 126 for a duty). They stay silent while it is a draft, and ring once it is
 * published (publishing queues nothing again). A member of the club gets the same answer: the
 * alert reads no membership. A TEST Event rings like the real day: it is a rehearsal (ruling 185).
 */
import { ConfigService } from '@nestjs/config';
import { HttpException, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  queriedTables,
  selectsFor,
  type TableSeed,
} from '../common/testing/supabase-chain';
import {
  NotificationSchedulerWorker,
  type NotificationKind,
} from './notification-scheduler.worker';

const SAM = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PUBLIC_EVENT = { status: 'published', event_kind: 'standard' };
const DRAFT_EVENT = { status: 'draft', event_kind: 'standard' };
const TEST_EVENT = { status: 'published', event_kind: 'test' };
const tournament = (status: string, events = PUBLIC_EVENT) => ({ status, events });
const phaseOf = (status: string, events = PUBLIC_EVENT) => ({
  phases: { tournaments: tournament(status, events) },
});

const TOURNAMENT = 'tournaments(status, events(status))';
type Read = [table: string, select: string, what: string];
const BOUT: Read = ['matches', `phases(${TOURNAMENT})`, 'alert bout'];
const DUTY: Read = [
  'referee_assignments',
  `events(status), pools(phases(${TOURNAMENT})), matches(phases(${TOURNAMENT}))`,
  'alert referee duty',
];
const SESSION: Read = [
  'workshop_sessions',
  'workshops(status, events(status))',
  'alert Workshop session',
];
// The kinds the gate checks: the table each reads, its projection, and the words of its 5xx.
const CHECKED: Array<[NotificationKind, Read]> = [
  ['match_starting', BOUT],
  ['follow_match_starting', BOUT],
  ['referee_starting', DUTY],
  ['follow_referee_starting', DUTY],
  ['assignment_changed', DUTY],
  ['follow_workshop_starting', SESSION],
];

function baseTables(): Record<string, TableSeed> {
  return {
    notification_preferences: { rows: [{ user_id: SAM, enabled: true }] },
    push_subscriptions: {
      rows: [{ user_id: SAM, endpoint: 'https://push.example/1', p256dh_key: 'k', auth_key: 'a' }],
    },
    matches: {
      rows: [
        { id: 'm-secret', ...phaseOf('draft') },
        { id: 'm-open', ...phaseOf('published') },
        { id: 'm-draft-event', ...phaseOf('published', DRAFT_EVENT) },
        { id: 'm-test-event', ...phaseOf('published', TEST_EVENT) },
        { id: 'm-no-event', phases: { tournaments: { status: 'published', events: null } } },
      ],
    },
    referee_assignments: {
      rows: [
        { id: 'd-pool-secret', events: PUBLIC_EVENT, pools: phaseOf('draft'), matches: null },
        { id: 'd-pool-open', events: PUBLIC_EVENT, pools: phaseOf('running'), matches: null },
        { id: 'd-bout-secret', events: PUBLIC_EVENT, pools: null, matches: phaseOf('draft') },
        { id: 'd-piste', events: PUBLIC_EVENT, pools: null, matches: null },
        { id: 'd-piste-draft-event', events: DRAFT_EVENT, pools: null, matches: null },
        { id: 'd-piste-test-event', events: TEST_EVENT, pools: null, matches: null },
      ],
    },
    workshop_sessions: {
      rows: [
        { id: 's-draft', workshops: { status: 'draft', events: PUBLIC_EVENT } },
        { id: 's-open', workshops: { status: 'published', events: PUBLIC_EVENT } },
        { id: 's-draft-event', workshops: { status: 'published', events: DRAFT_EVENT } },
        { id: 's-test-event', workshops: { status: 'published', events: TEST_EVENT } },
      ],
    },
  };
}

let db: ReturnType<typeof mockSupabase>;
const sender = { send: vi.fn() };

function worker() {
  return new NotificationSchedulerWorker(
    db as never,
    new ConfigService({}) as never,
    sender as never,
    { sendNotification: vi.fn() } as never,
  );
}

async function fire(kind: NotificationKind, entityId: string): Promise<boolean> {
  sender.send.mockClear();
  await worker().process({
    id: 'job-1',
    data: { kind, entityId, userId: SAM, title: 'Soon', body: 'Léa fights soon.', url: '/n' },
  } as never);
  return sender.send.mock.calls.length > 0;
}

beforeEach(() => {
  db = mockSupabase(baseTables());
  sender.send.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  ["Léa's own bout alert (ruling 183)", 'match_starting'],
  ["a followed fighter's bout alert (ruling 130's next bout)", 'follow_match_starting'],
] as Array<[string, NotificationKind]>)('%s', (_, kind) => {
  it('stays silent for a bout of the draft Winter Secret, and says so in the log', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    expect(await fire(kind, 'm-secret')).toBe(false);
    expect(log).toHaveBeenCalledWith(`Dropped ${kind} for m-secret: hidden or gone`);
    expect(queriedTables(db.from)).not.toContain('push_subscriptions');
    expect(queriedTables(db.from)).not.toContain('organization_members');
  });

  it('rings once the Tournament is published', async () => {
    expect(await fire(kind, 'm-open')).toBe(true);
  });

  it('rings for a bout of a test Event: a rehearsal (ruling 185)', async () => {
    expect(await fire(kind, 'm-test-event')).toBe(true);
  });

  it.each([
    ['of a published Tournament in a draft Event', 'm-draft-event'],
    ['read without its Event', 'm-no-event'],
    ['deleted since it was queued', 'm-gone'],
  ])('stays silent for a bout %s', async (_, bout) => {
    expect(await fire(kind, bout)).toBe(false);
  });
});

describe.each([
  ["Marc's own duty alert (ruling 184)", 'referee_starting'],
  ["Marc's lock message: held for a draft, sent on publish (ruling 186)", 'assignment_changed'],
  ["a followed referee's duty alert (ruling 126)", 'follow_referee_starting'],
] as Array<[string, NotificationKind]>)('%s', (_, kind) => {
  it.each([
    ['a Pool of the draft Winter Secret', 'd-pool-secret', false],
    ['a bout of the draft Winter Secret', 'd-bout-secret', false],
    ['a Pool of a running Tournament', 'd-pool-open', true],
    ['a piste of a public Event', 'd-piste', true],
    ['a piste of a draft Event', 'd-piste-draft-event', false],
    ['a piste of a test Event', 'd-piste-test-event', true],
    ['a duty deleted since it was queued', 'd-gone', false],
  ])('%s (%s): rings = %s', async (_, duty, rings) => {
    expect(await fire(kind, duty)).toBe(rings);
  });
});

describe("a followed instructor's Workshop alert", () => {
  it.each([
    ['a draft Workshop', 's-draft', false],
    ['a published Workshop', 's-open', true],
    ['a published Workshop of a draft Event', 's-draft-event', false],
    ['a published Workshop of a test Event', 's-test-event', true],
    ['a session deleted since it was queued', 's-gone', false],
  ])('%s (%s): rings = %s', async (_, session, rings) => {
    expect(await fire('follow_workshop_starting', session)).toBe(rings);
  });
});

describe('what the gate reads', () => {
  it.each(CHECKED)('%s reads its row by id', async (kind, [table, select]) => {
    await fire(kind, 'x');
    expect(selectsFor(db.from, table)).toEqual([select]);
  });

  it('checks nothing for an alert about no bout, duty or Workshop: an organiser broadcast', async () => {
    expect(await fire('organizer_broadcast', 'm-secret')).toBe(true);
    expect(queriedTables(db.from)).not.toContain('matches');
  });

  it.each(CHECKED)(
    '%s fails the job on a failed read, sending nothing',
    async (kind, [table, , what]) => {
      db = mockSupabase({ ...baseTables(), [table]: { data: null, error: { message: 'boom' } } });
      const failure = await fire(kind, 'x').then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(HttpException);
      expect(String(failure)).toContain(`${what} read failed: boom`);
      expect(sender.send).not.toHaveBeenCalled();
    },
  );
});
