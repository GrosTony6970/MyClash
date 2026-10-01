/**
 * A notice Léa switched off sends nothing (ruling 200). Léa turns "Results published" off on her
 * settings page. Before, her phone stayed silent and the email still went out: the worker took
 * "off" for "no phone alert" and fell back to the email. The main switch did the same, under a
 * label that says "pause all reminders and alerts". Off now means no phone alert and no email.
 * One thing passes the main switch: an organiser's own announcement ("the venue changed") still
 * arrives by email. The email stays the fallback of a reader who has no phone alert set up.
 */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  mockSupabase,
  scopedTo,
  selectsFor,
  writesTo,
  type SupabaseRow,
  type TableSeed,
} from '../common/testing/supabase-chain';
import {
  NotificationSchedulerWorker,
  type NotificationKind,
  type NotificationPreferenceToggle,
  type ScheduledNotificationJob,
} from './notification-scheduler.worker';

const LEA = 'u-lea';
const THING = 'thing-1';
const PHONE = {
  user_id: LEA,
  endpoint: 'https://push.example/lea',
  p256dh_key: 'k',
  auth_key: 'a',
};

/** Léa's settings row; null = she never saved one. */
function tables(settings: SupabaseRow | null, phones: SupabaseRow[] = [PHONE]) {
  return {
    notification_preferences: { rows: settings ? [{ user_id: LEA, ...settings }] : [] },
    push_subscriptions: { rows: phones },
    event_broadcast_recipients: { rows: [{ id: 'r-lea' }] },
    // What the send gate reads for the lock message and for a bout alert: both public.
    referee_assignments: {
      rows: [{ id: THING, events: { status: 'published' }, pools: null, matches: null }],
    },
    matches: {
      rows: [
        {
          id: THING,
          phases: { tournaments: { status: 'published', events: { status: 'published' } } },
        },
      ],
    },
  } satisfies Record<string, TableSeed>;
}

const sender = { send: vi.fn() };
const mail = { sendNotification: vi.fn(), sendBroadcastNotification: vi.fn() };
let db: ReturnType<typeof mockSupabase>;
let log: MockInstance<Logger['log']>;

function notice(
  kind: NotificationKind,
  preference?: NotificationPreferenceToggle,
): ScheduledNotificationJob {
  return {
    kind,
    entityId: THING,
    userId: LEA,
    title: 'A title',
    body: 'A body.',
    url: '/notifications',
    email: 'lea@example.com',
    emailSubject: 'A subject',
    ...(preference ? { preference } : {}),
  };
}

/** The worker's turn on one notice; what went to her phone and to her mailbox. */
async function sent(job: ScheduledNotificationJob, seed: Record<string, TableSeed>) {
  db = mockSupabase(seed);
  const worker = new NotificationSchedulerWorker(
    db as never,
    new ConfigService({}) as never,
    sender as never,
    mail as never,
  );
  await worker.process({ id: 'job-1', data: job } as never);
  return {
    phone: sender.send.mock.calls.length,
    email:
      mail.sendNotification.mock.calls.length + mail.sendBroadcastNotification.mock.calls.length,
  };
}

const NOTHING = { phone: 0, email: 0 };
const skipped = (kind: NotificationKind) => `Skipped ${kind} for ${THING}: switched off`;

/** Every notice that carries its own switch, with the switch that names it. */
const SWITCHED: Array<[string, NotificationKind, NotificationPreferenceToggle]> = [
  ['the results notice', 'results_published', 'results_published'],
  ['the Swiss round message', 'swiss_round_published', 'swiss_round_published'],
  ['the new Event of an organiser she follows', 'organizer_published_event', 'organizer_updates'],
  ["the referee's lock message", 'assignment_changed', 'schedule_changes'],
  ['a refused exchange correction', 'exchange_edit_rejected', 'schedule_changes'],
];

/** The notices with no switch of their own: only the main switch stops them. */
const UNSWITCHED: Array<[string, NotificationKind]> = [
  ['a cancelled Workshop', 'workshop_cancelled'],
  ['a waitlist place', 'waitlist_promoted'],
];

beforeEach(() => {
  sender.send.mockReset();
  mail.sendNotification.mockReset();
  mail.sendBroadcastNotification.mockReset();
  log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a notice whose own switch Léa turned off', () => {
  it.each(SWITCHED)('%s: no phone alert, no email', async (_, kind, toggle) => {
    const seed = tables({ enabled: true, [toggle]: false });
    expect(await sent(notice(kind, toggle), seed)).toEqual(NOTHING);
    expect(log).toHaveBeenCalledWith(skipped(kind));
  });

  it('another switch turned off leaves it alone', async () => {
    const seed = tables({ enabled: true, results_published: false });
    const swiss = notice('swiss_round_published', 'swiss_round_published');
    expect(await sent(swiss, seed)).toEqual({ phone: 1, email: 0 });
  });

  it('reads the main switch and every switch of its own', async () => {
    await sent(notice('results_published', 'results_published'), tables({ enabled: true }));
    // The double ignores projections: a switch left out of the read would count as "on".
    expect(selectsFor(db.from, 'notification_preferences')).toEqual([
      'user_id, enabled, schedule_changes, results_published, organizer_updates, swiss_round_published',
    ]);
  });
});

describe('the main switch turned off', () => {
  it.each([...SWITCHED.map(([name, kind]) => [name, kind] as const), ...UNSWITCHED])(
    '%s: no phone alert, no email',
    async (_, kind) => {
      expect(await sent(notice(kind), tables({ enabled: false }))).toEqual(NOTHING);
      expect(log).toHaveBeenCalledWith(skipped(kind));
    },
  );

  it("an organiser's announcement still arrives, by email", async () => {
    const announcement = { ...notice('organizer_broadcast'), recipientId: 'r-lea' };
    expect(await sent(announcement, tables({ enabled: false }))).toEqual({ phone: 0, email: 1 });
    expect(mail.sendBroadcastNotification).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'lea@example.com', title: 'A title' }),
    );
    const marked = writesTo(db, 'event_broadcast_recipients');
    expect(marked).toMatchObject([{ op: 'update', row: { delivery_status: 'delivered' } }]);
    expect(scopedTo(marked[0], 'id')).toBe('r-lea');
    expect(log).not.toHaveBeenCalledWith(skipped('organizer_broadcast'));
  });

  it('a bout alert queued before she switched off: no phone alert', async () => {
    // A timed alert carries no address: it never had an email to fall back to.
    const alert: ScheduledNotificationJob = {
      kind: 'match_starting',
      entityId: THING,
      userId: LEA,
      title: 'A title',
      body: 'A body.',
      url: '/notifications',
    };
    expect(await sent(alert, tables({ enabled: false }))).toEqual(NOTHING);
    expect(log).toHaveBeenCalledWith(skipped('match_starting'));
  });
});

describe('a notice Léa left on', () => {
  it.each<[string, SupabaseRow | null]>([
    ['every switch on', { enabled: true, results_published: true }],
    ['settings she never saved', null],
  ])('goes to her phone, with no email: %s', async (_, settings) => {
    const results = notice('results_published', 'results_published');
    expect(await sent(results, tables(settings))).toEqual({ phone: 1, email: 0 });
  });

  it('goes out when her switches cannot be read, and the log says so', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const seed = { ...tables(null), notification_preferences: { error: { message: 'boom' } } };
    const results = notice('results_published', 'results_published');
    expect(await sent(results, seed)).toEqual({ phone: 1, email: 0 });
    expect(warn).toHaveBeenCalledWith(`Switches of ${LEA} unreadable, taken as on: boom`);
  });

  it('goes to her mailbox when she has no phone alert set up', async () => {
    const results = notice('results_published', 'results_published');
    expect(await sent(results, tables({ enabled: true }, []))).toEqual({ phone: 0, email: 1 });
    expect(mail.sendNotification).toHaveBeenCalledWith({
      to: 'lea@example.com',
      subject: 'A subject',
      title: 'A title',
      body: 'A body.',
      actionUrl: '/notifications',
    });
  });
});
