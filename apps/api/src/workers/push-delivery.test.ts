/**
 * A dead phone address no longer fails an alert. Anna set up phone alerts on two phones, then
 * threw the old one away. Before, every alert rang her new phone, then the old address answered
 * "gone", the whole job was marked failed, and the address stayed for the next alert. With one
 * dead address only, she got no phone alert and no email at all.
 *
 * Now an address the push service calls gone (404 or 410) is removed, and the alert counts the
 * phones that rang. With none left she is a reader with no phone alert set up: the email goes.
 * A push service that is down is not a dead address: nothing is removed, and when no phone rang
 * the job fails as before.
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
import { ALERT_SENT } from './duty-alert-rings';
import {
  NotificationSchedulerWorker,
  type ScheduledNotificationJob,
} from './notification-scheduler.worker';

vi.mock('./alert-still-wanted', () => ({ isStillWanted: async () => true }));

const ANNA = 'u-anna';
const THING = 'thing-1';
const NEW_PHONE = {
  id: 'sub-new',
  user_id: ANNA,
  endpoint: 'https://push.example/new',
  p256dh_key: 'k-new',
  auth_key: 'a-new',
};
const OLD_PHONE = {
  id: 'sub-old',
  user_id: ANNA,
  endpoint: 'https://push.example/old',
  p256dh_key: 'k-old',
  auth_key: 'a-old',
};

function tables(phones: TableSeed): Record<string, TableSeed> {
  return {
    notification_preferences: { rows: [] },
    push_subscriptions: phones,
    event_broadcast_recipients: { rows: [{ id: 'r-anna' }] },
    // What the send gate reads for a bout alert: public.
    matches: {
      rows: [
        {
          id: THING,
          phases: { tournaments: { status: 'published', events: { status: 'published' } } },
        },
      ],
    },
  };
}

/** What the push service answers for one address: nothing (it rang), or an error. */
type Answers = Record<string, unknown>;

/** The push service's error, as `web-push` throws it: one message, the status beside it. */
function pushError(statusCode: number): Error {
  return Object.assign(new Error('Received unexpected response code'), { statusCode });
}

const sender = { send: vi.fn() };
const mail = { sendNotification: vi.fn(), sendBroadcastNotification: vi.fn() };
let db: ReturnType<typeof mockSupabase>;
let warn: MockInstance<Logger['warn']>;
let log: MockInstance<Logger['log']>;

/** A results notice: sent at once, with her address for the email fallback. */
const NOTICE: ScheduledNotificationJob = {
  kind: 'results_published',
  entityId: THING,
  userId: ANNA,
  recipientId: 'r-anna',
  title: 'A title',
  body: 'A body.',
  url: '/notifications',
  email: 'anna@example.com',
  emailSubject: 'A subject',
};

/** A bout alert: timed, with no address. */
const ALERT: ScheduledNotificationJob = {
  kind: 'match_starting',
  entityId: THING,
  userId: ANNA,
  title: 'A title',
  body: 'A body.',
  url: '/notifications',
};

/** The worker's turn on one notice, each address answering as `answers` says. */
function fire(job: ScheduledNotificationJob, phones: TableSeed, answers: Answers = {}) {
  db = mockSupabase(tables(phones));
  sender.send.mockImplementation(async ({ endpoint }: { endpoint: string }) => {
    if (answers[endpoint]) throw answers[endpoint];
  });
  const worker = new NotificationSchedulerWorker(
    db as never,
    new ConfigService({}) as never,
    sender as never,
    mail as never,
  );
  return worker.process({ id: 'job-1', data: job } as never);
}

const rangAt = () =>
  sender.send.mock.calls.map(([phone]) => (phone as { endpoint: string }).endpoint);
const removed = () => writesTo(db, 'push_subscriptions').filter((write) => write.op === 'delete');
const marked = () => writesTo(db, 'event_broadcast_recipients');
const BOTH: SupabaseRow[] = [NEW_PHONE, OLD_PHONE];

beforeEach(() => {
  sender.send.mockReset();
  mail.sendNotification.mockReset();
  mail.sendBroadcastNotification.mockReset();
  log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('an address the push service calls gone', () => {
  it.each([404, 410])('%i: the other phone rang, the alert is sent', async (status) => {
    const answer = await fire(NOTICE, { rows: BOTH }, { [OLD_PHONE.endpoint]: pushError(status) });

    expect(answer).toBe(ALERT_SENT);
    expect(rangAt()).toEqual([NEW_PHONE.endpoint, OLD_PHONE.endpoint]);
    expect(mail.sendNotification).not.toHaveBeenCalled();
    expect(marked()).toMatchObject([{ op: 'update', row: { delivery_status: 'delivered' } }]);
    expect(scopedTo(marked()[0], 'id')).toBe('r-anna');
  });

  it('is removed, by its own row and no other', async () => {
    await fire(NOTICE, { rows: BOTH }, { [OLD_PHONE.endpoint]: pushError(410) });

    expect(removed()).toHaveLength(1);
    expect(removed()[0]?.filters).toEqual([{ method: 'in', args: ['id', [OLD_PHONE.id]] }]);
    expect(log).toHaveBeenCalledWith(`Removed 1 dead push subscriptions of ${ANNA}`);
  });

  it('reads the row id it removes by, for her account alone', async () => {
    await fire(NOTICE, { rows: [...BOTH, { ...NEW_PHONE, id: 'sub-marc', user_id: 'u-marc' }] });

    // The double ignores projections: an id left out of the read would remove by `undefined`.
    expect(selectsFor(db.from, 'push_subscriptions')).toEqual([
      'id, endpoint, p256dh_key, auth_key',
    ]);
    expect(sender.send).toHaveBeenCalledTimes(2);
  });

  it('her only address: it is removed and the email goes, as for no phone alert set up', async () => {
    const answer = await fire(
      NOTICE,
      { rows: [OLD_PHONE] },
      { [OLD_PHONE.endpoint]: pushError(410) },
    );

    expect(answer).toBe(ALERT_SENT);
    expect(removed()[0]?.filters).toEqual([{ method: 'in', args: ['id', [OLD_PHONE.id]] }]);
    expect(mail.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'anna@example.com', title: 'A title' }),
    );
    expect(marked()).toMatchObject([{ op: 'update', row: { delivery_status: 'delivered' } }]);
  });

  it('her only address, a timed alert: removed, and the job does not fail', async () => {
    const answer = await fire(
      ALERT,
      { rows: [OLD_PHONE] },
      { [OLD_PHONE.endpoint]: pushError(404) },
    );

    expect(answer).toBe(ALERT_SENT);
    expect(removed()).toHaveLength(1);
    expect(mail.sendNotification).not.toHaveBeenCalled();
  });

  it('a removal that fails is said in the log and does not fail the alert', async () => {
    const phones = [
      { data: BOTH, error: null },
      { data: null, error: { message: 'boom' } },
    ];
    const answer = await fire(NOTICE, phones, { [OLD_PHONE.endpoint]: pushError(410) });

    expect(answer).toBe(ALERT_SENT);
    expect(warn).toHaveBeenCalledWith(`Dead push subscriptions of ${ANNA} not removed: boom`);
  });

  it('every phone rang: nothing is removed', async () => {
    await fire(NOTICE, { rows: BOTH });

    expect(removed()).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('a push service that is down', () => {
  const DOWN: Array<[string, unknown, string]> = [
    ['a 500', pushError(500), 'Received unexpected response code 500'],
    ['too many requests', pushError(429), 'Received unexpected response code 429'],
    ['a refused key', pushError(403), 'Received unexpected response code 403'],
    ['no answer at all', new Error('socket hang up'), 'socket hang up'],
  ];

  it.each(DOWN)('%s on one phone, the other rang: sent, nothing removed', async (_, error, why) => {
    const answer = await fire(NOTICE, { rows: BOTH }, { [OLD_PHONE.endpoint]: error });

    expect(answer).toBe(ALERT_SENT);
    expect(removed()).toEqual([]);
    expect(mail.sendNotification).not.toHaveBeenCalled();
    expect(marked()).toMatchObject([{ op: 'update', row: { delivery_status: 'delivered' } }]);
    expect(warn).toHaveBeenCalledWith(`1 of 2 phones of ${ANNA} not reached: ${why}`);
    expect(log).toHaveBeenCalledWith(
      `Sent results_published notification for ${THING} to 1 subscriptions`,
    );
  });

  it.each(DOWN)('%s on her only phone: the job fails, nothing removed', async (_, error, why) => {
    const fired = fire(NOTICE, { rows: [NEW_PHONE] }, { [NEW_PHONE.endpoint]: error });

    await expect(fired).rejects.toThrow(`No phone of ${ANNA} reached: ${why}`);
    expect(removed()).toEqual([]);
    expect(mail.sendNotification).not.toHaveBeenCalled();
    expect(marked()).toEqual([]);
  });

  it('one address gone and the other down: the gone one is removed, the job fails', async () => {
    const fired = fire(
      NOTICE,
      { rows: BOTH },
      { [OLD_PHONE.endpoint]: pushError(410), [NEW_PHONE.endpoint]: pushError(500) },
    );

    await expect(fired).rejects.toThrow(`No phone of ${ANNA} reached`);
    expect(removed()[0]?.filters).toEqual([{ method: 'in', args: ['id', [OLD_PHONE.id]] }]);
    expect(mail.sendNotification).not.toHaveBeenCalled();
  });
});

describe('her phone addresses cannot be read', () => {
  it('fails the job: it is not "no phone alert set up"', async () => {
    const fired = fire(NOTICE, { error: { message: 'boom' } });

    await expect(fired).rejects.toThrow('Failed to load push subscriptions: boom');
    expect(mail.sendNotification).not.toHaveBeenCalled();
  });
});
