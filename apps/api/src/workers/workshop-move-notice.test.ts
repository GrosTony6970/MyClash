/**
 * A moved Workshop session tells its people ONCE, after the moves stop (operator ruling,
 * 2026-11-09).
 *
 * "Longsword basics" runs Saturday 10:00 in the Main hall, Room A (Paris time). Léa has an account
 * and a confirmed seat; Zoé has an account and a place on the waitlist; Tom booked as a guest, so
 * there is no account to tell; Ana was refused. The organiser drags the card to 14:00, Room B,
 * tries another room, then settles. Léa and Zoé hear once, ten minutes after the last move, where
 * it runs now. Had the organiser put it back at 10:00, Room A, nobody would hear anything.
 */
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, type TableSeed } from '../common/testing/supabase-chain';
import {
  NotificationSchedulerService,
  NotificationSchedulerWorker,
  type ScheduledNotificationJob,
} from './notification-scheduler.worker';
import { WORKSHOP_MOVE_SETTLE_MS, samePlace, type SessionPlace } from './workshop-move-notice';
import { workshopMoved } from '../modules/notifications/notice-texts/notice-texts';

// Whether the seat is still held when it fires is alert-still-wanted.test.ts's question.
vi.mock('./alert-still-wanted', () => ({ isStillWanted: async () => true }));

const PUBLIC_EVENT = { status: 'published', timezone: 'Europe/Paris' };
const ROOM_A = { venueId: 'v-main', areaId: 'a-room-a' };
const ROOM_B = { venueId: 'v-main', areaId: 'a-room-b' };
// Saturday 14 November 2026: 10:00 and 14:00 in Paris.
const TEN: SessionPlace = {
  startsAt: '2026-11-14T09:00:00Z',
  endsAt: '2026-11-14T10:00:00Z',
  ...ROOM_A,
};
const TWO_PM_ROOM_B: SessionPlace = {
  startsAt: '2026-11-14T13:00:00+00:00',
  endsAt: '2026-11-14T14:00:00+00:00',
  ...ROOM_B,
};

const sessionRow = (place: SessionPlace, opts: { status?: string; workshop?: string } = {}) => ({
  id: 's-1',
  status: opts.status ?? 'scheduled',
  starts_at: place.startsAt,
  ends_at: place.endsAt,
  venue_id: place.venueId,
  area_id: place.areaId,
  location_label: null,
  workshops: {
    title: 'Longsword basics',
    status: opts.workshop ?? 'published',
    events: PUBLIC_EVENT,
  },
  venues: { name: 'Main hall' },
  venue_areas: { name: place.areaId === 'a-room-b' ? 'Room B' : 'Room A' },
});
// A booking names a roster row (`user_id` holds a persons.id); the row holds the account.
const booking = (row: string, status: string) => ({
  workshop_session_id: 's-1',
  user_id: row,
  status,
});
const rosterRow = (id: string, account: string | null, email: string | null) => ({
  id,
  claimed_by_user_id: account,
  email,
});

function tables(now: SessionPlace, opts: { status?: string; workshop?: string } = {}) {
  return {
    workshop_sessions: { rows: [sessionRow(now, opts)] },
    workshop_enrollments: {
      rows: [
        booking('lea-row', 'confirmed'),
        booking('zoe-row', 'waitlisted'),
        booking('tom-row', 'confirmed'),
        booking('ana-row', 'refused'),
      ],
    },
    persons: {
      rows: [
        rosterRow('lea-row', 'u-lea', 'lea@example.test'),
        rosterRow('zoe-row', 'u-zoe', 'zoe@example.test'),
        rosterRow('tom-row', null, null),
        rosterRow('ana-row', 'u-ana', 'ana@example.test'),
      ],
    },
    notification_preferences: { rows: [{ user_id: 'u-lea', enabled: true }] },
    push_subscriptions: {
      rows: [
        { user_id: 'u-lea', endpoint: 'https://push.example/1', p256dh_key: 'k', auth_key: 'a' },
      ],
    },
  } satisfies Record<string, TableSeed>;
}

function scheduler(now: SessionPlace, pending: Partial<ScheduledNotificationJob> | null = null) {
  const removed: string[] = [];
  const queue = {
    add: vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn(async (id: string) =>
      pending ? { data: pending, remove: async () => void removed.push(id) } : undefined,
    ),
  };
  const db = mockSupabase(tables(now));
  const service = new NotificationSchedulerService(queue as never, db as never);
  return { service, queue, removed, db };
}

const queued = (queue: { add: ReturnType<typeof vi.fn> }) =>
  queue.add.mock.calls.map(([, data, opts]) => ({
    jobId: (opts as { jobId: string }).jobId,
    delay: (opts as { delay: number }).delay,
    data: data as ScheduledNotificationJob,
  }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a move queues the notice of each account booked', () => {
  it('Léa and Zoé, ten minutes out, with where the session was', async () => {
    const { service, queue, db } = scheduler(TWO_PM_ROOM_B);

    await service.scheduleWorkshopMoved('s-1', TEN);

    const jobs = queued(queue);
    // Tom has no account, and Ana's booking was refused.
    expect(jobs.map((job) => job.jobId).sort()).toEqual([
      'notification.workshop_moved.s-1.u-lea',
      'notification.workshop_moved.s-1.u-zoe',
    ]);
    for (const job of jobs) {
      expect(job.delay).toBe(WORKSHOP_MOVE_SETTLE_MS);
      expect(job.data).toMatchObject({
        kind: 'workshop_moved',
        entityId: 's-1',
        preference: 'schedule_changes',
        movedFrom: TEN,
      });
    }
    expect(jobs.find((job) => job.data.userId === 'u-lea')?.data.email).toBe('lea@example.test');
    // The double ignores the projection: only this holds what is read. A booking has no foreign
    // key to its roster row, so an embed of `persons` would be refused by PostgREST.
    expect(selectsFor(db.from, 'workshop_enrollments')).toEqual(['user_id']);
    expect(selectsFor(db.from, 'persons')).toEqual(['claimed_by_user_id, email']);
  });

  it('replaces a pending notice, keeping where the session was before the FIRST move', async () => {
    const { service, queue, removed } = scheduler(TWO_PM_ROOM_B, { movedFrom: TEN });
    const middle = { ...TWO_PM_ROOM_B, ...ROOM_A };

    await service.scheduleWorkshopMoved('s-1', middle);

    expect(removed.sort()).toEqual([
      'notification.workshop_moved.s-1.u-lea',
      'notification.workshop_moved.s-1.u-zoe',
    ]);
    expect(queued(queue).map((job) => job.data.movedFrom)).toEqual([TEN, TEN]);
  });

  it('queues nothing for a save that moved nothing', async () => {
    const { service, queue } = scheduler(TWO_PM_ROOM_B);

    await service.scheduleWorkshopMoved('s-1', {
      ...TWO_PM_ROOM_B,
      startsAt: '2026-11-14T13:00:00Z',
    });

    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('when the notice fires', () => {
  const sender = { send: vi.fn() };
  async function fire(now: SessionPlace, opts: { status?: string; workshop?: string } = {}) {
    sender.send.mockReset();
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const worker = new NotificationSchedulerWorker(
      mockSupabase(tables(now, opts)) as never,
      new ConfigService({}) as never,
      sender as never,
      { sendNotification: vi.fn() } as never,
    );
    await worker.process({
      id: 'job-1',
      data: {
        kind: 'workshop_moved',
        entityId: 's-1',
        userId: 'u-lea',
        // As queued at an earlier move: the session has moved again since.
        title: 'Workshop moved',
        body: 'Longsword basics now starts at an old place.',
        url: '/notifications',
        movedFrom: TEN,
      },
    } as never);
    const sent = sender.send.mock.calls.map(([, payload]) => payload as { body: string });
    return { sent, log };
  }

  it('says where the session runs NOW, on the Event clock', async () => {
    const { sent } = await fire(TWO_PM_ROOM_B);

    expect(sent).toHaveLength(1);
    const [notice] = sent as [{ body: string }];
    expect(notice.body).toContain('14:00');
    expect(notice.body).toContain('Main hall · Room B');
    expect(notice.body).not.toContain('old place');
  });

  it('sends nothing when the session is back where it was, and says so in the log', async () => {
    const { sent, log } = await fire({ ...TEN, startsAt: '2026-11-14T09:00:00+00:00' });

    expect(sent).toEqual([]);
    expect(log).toHaveBeenCalledWith('Dropped workshop_moved for s-1: not moved');
  });

  it.each([
    ['the Workshop went back to draft', { workshop: 'draft' }],
    ['the session was cancelled', { status: 'cancelled' }],
  ])('sends nothing when %s', async (_, opts) => {
    const { sent, log } = await fire(TWO_PM_ROOM_B, opts);

    expect(sent).toEqual([]);
    expect(log).toHaveBeenCalledWith('Dropped workshop_moved for s-1: hidden or gone');
  });
});

describe('the words of the notice', () => {
  it('names the room, the time, or says the time is not set', () => {
    const when = { fr: 'sam. 14 nov., 14:00', en: 'Sat 14 Nov, 14:00' };
    expect(workshopMoved('Longsword basics', when, 'Room B').body).toBe(
      'Nouvel horaire : Longsword basics, sam. 14 nov., 14:00, Room B. / ' +
        'Longsword basics now starts Sat 14 Nov, 14:00, Room B.',
    );
    expect(workshopMoved('Longsword basics', when, null).body).toBe(
      'Nouvel horaire : Longsword basics, sam. 14 nov., 14:00. / ' +
        'Longsword basics now starts Sat 14 Nov, 14:00.',
    );
    expect(workshopMoved(null, null, null).body).toBe(
      "Déplacé : votre atelier. Le nouvel horaire n'est pas encore fixé. / " +
        'Your workshop was moved. Its new time is not set yet.',
    );
  });

  it('reads one instant however it is written', () => {
    expect(samePlace(TEN, { ...TEN, startsAt: '2026-11-14T09:00:00.000+00:00' })).toBe(true);
    expect(samePlace(TEN, { ...TEN, areaId: 'a-room-b' })).toBe(false);
  });
});
