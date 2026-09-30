/**
 * A follower's "starting soon" fires only for what the public may see, checked when it fires
 * (rulings 129, 130, 163, and 126 for a referee's duty). Sam follows Léa. The organiser planned
 * her bouts in the draft Winter Secret of the public Winter Games before publishing it, so the
 * alerts sit in the queue from then on: they must stay silent while it is a draft, and ring once
 * it is published (publishing queues nothing again). Sam runs no club here, and a member of the
 * club would get the same answer: the alert reads no membership.
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
  type FollowNotificationKind,
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

const TOURNAMENT = 'tournaments(status, events(status, event_kind))';
// The table each alert reads, its projection, and the words of its 5xx.
const SELECTS: Record<FollowNotificationKind, [string, string, string]> = {
  follow_match_starting: ['matches', `phases(${TOURNAMENT})`, 'follow alert bout'],
  follow_referee_starting: [
    'referee_assignments',
    `events(status, event_kind), pools(phases(${TOURNAMENT})), matches(phases(${TOURNAMENT}))`,
    'follow alert referee duty',
  ],
  follow_workshop_starting: [
    'workshop_sessions',
    'workshops(status, events(status, event_kind))',
    'follow alert Workshop session',
  ],
};

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
      ],
    },
    workshop_sessions: {
      rows: [
        { id: 's-draft', workshops: { status: 'draft', events: PUBLIC_EVENT } },
        { id: 's-open', workshops: { status: 'published', events: PUBLIC_EVENT } },
        { id: 's-draft-event', workshops: { status: 'published', events: DRAFT_EVENT } },
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

describe("a followed fighter's bout alert (ruling 130's next bout)", () => {
  it('stays silent for a bout of the draft Winter Secret, and says so in the log', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    expect(await fire('follow_match_starting', 'm-secret')).toBe(false);
    expect(log).toHaveBeenCalledWith('Dropped follow_match_starting for m-secret: hidden or gone');
    expect(queriedTables(db.from)).not.toContain('push_subscriptions');
    expect(queriedTables(db.from)).not.toContain('organization_members');
  });

  it('rings once the Tournament is published', async () => {
    expect(await fire('follow_match_starting', 'm-open')).toBe(true);
  });

  it.each([
    ['of a published Tournament in a draft Event', 'm-draft-event'],
    ['of a test Event', 'm-test-event'],
    ['read without its Event', 'm-no-event'],
    ['deleted since it was queued', 'm-gone'],
  ])('stays silent for a bout %s', async (_, bout) => {
    expect(await fire('follow_match_starting', bout)).toBe(false);
  });
});

describe("a followed referee's duty alert (ruling 126)", () => {
  it.each([
    ['a Pool of the draft Winter Secret', 'd-pool-secret', false],
    ['a bout of the draft Winter Secret', 'd-bout-secret', false],
    ['a Pool of a running Tournament', 'd-pool-open', true],
    ['a piste of a public Event', 'd-piste', true],
    ['a piste of a draft Event', 'd-piste-draft-event', false],
    ['a duty deleted since it was queued', 'd-gone', false],
  ])('%s (%s): rings = %s', async (_, duty, rings) => {
    expect(await fire('follow_referee_starting', duty)).toBe(rings);
  });
});

describe("a followed instructor's Workshop alert", () => {
  it.each([
    ['a draft Workshop', 's-draft', false],
    ['a published Workshop', 's-open', true],
    ['a published Workshop of a draft Event', 's-draft-event', false],
    ['a session deleted since it was queued', 's-gone', false],
  ])('%s (%s): rings = %s', async (_, session, rings) => {
    expect(await fire('follow_workshop_starting', session)).toBe(rings);
  });
});

describe('what the gate reads', () => {
  it.each(Object.entries(SELECTS))('%s reads its row by id', async (kind, [table, select]) => {
    await fire(kind as FollowNotificationKind, 'x');
    expect(selectsFor(db.from, table)).toEqual([select]);
  });

  it("leaves the fighter's own alert to its own rules: no bout read", async () => {
    expect(await fire('match_starting', 'm-secret')).toBe(true);
    expect(queriedTables(db.from)).not.toContain('matches');
  });

  it.each(Object.entries(SELECTS))(
    '%s fails the job on a failed read, sending nothing',
    async (kind, [table, , what]) => {
      db = mockSupabase({ ...baseTables(), [table]: { data: null, error: { message: 'boom' } } });
      const failure = await fire(kind as FollowNotificationKind, 'x').then(
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
