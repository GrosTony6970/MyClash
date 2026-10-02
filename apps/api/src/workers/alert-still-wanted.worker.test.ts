/**
 * The fire-time "still wanted" check, where it meets its neighbours (operator ruling 213): the
 * scheduler that sets a follower's alerts, and the worker that sends them.
 */
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, queriedTables, type TableSeed } from '../common/testing/supabase-chain';
import { bout, follows, tables } from './alert-still-wanted.fixtures';
import { isStillWanted } from './alert-still-wanted';
import { NOW, setup } from './follow-notification-scheduler.apply.fixtures';
import {
  NotificationSchedulerService,
  NotificationSchedulerWorker,
  type NotificationKind,
} from './notification-scheduler.worker';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('who an alert is for has two owners: the one that sets it, and this check', () => {
  it('lets every alert ring that a follow has just set', async () => {
    // The real builder, on the fixture of its own tests: Marc follows Léa, every switch on.
    const { service, queue, db } = setup();
    await service.applyFollow('lea', 'marc', NOW);
    const jobs = queue.add.mock.calls.map((call) => call[1] as { kind: NotificationKind });

    expect(jobs.map((job) => job.kind).sort()).toEqual([
      'follow_match_starting',
      'follow_referee_starting',
      'follow_workshop_starting',
    ]);
    for (const job of jobs) {
      await expect(isStillWanted(db as never, job as never)).resolves.toBe(true);
    }
  });

  it('lets the alert ring that a hub follow has just set (ruling 217)', async () => {
    // Paul referees from the directory: no roster row in the Event, so no Event follow of him.
    const { service, queue, db } = setup({
      referee_assignments: {
        rows: [
          {
            id: 'duty-of-paul',
            person_id: 'gp-paul',
            event_id: 'event-1',
            match_id: 'bout-of-zoe',
            status: 'confirmed',
          },
        ],
      },
      directory_follows: {
        rows: [
          {
            follower_user_id: 'marc',
            followed_global_person_id: 'gp-paul',
            notify_referee_start: true,
          },
        ],
      },
      events: { rows: [{ id: 'event-1', event_kind: 'standard', organization_id: 'org-1' }] },
    });

    await service.scheduleRefereeStarting('duty-of-paul', NOW);
    const jobs = queue.add.mock.calls.map((call) => call[1] as { kind: NotificationKind });

    expect(jobs).toMatchObject([
      { kind: 'follow_referee_starting', entityId: 'duty-of-paul', userId: 'marc' },
    ]);
    await expect(isStillWanted(db as never, jobs[0] as never)).resolves.toBe(true);
  });

  it("lets the referee's own alert ring that the lock has just set (ruling 220)", async () => {
    // Léa's account holds her profile; duty-1 is locked, on a bout an hour ahead.
    const { queue, db } = setup({
      global_persons: { rows: [{ id: 'gp-lea', claimed_by_user_id: 'u-lea' }] },
    });
    const own = new NotificationSchedulerService(queue as never, db as never);

    await own.scheduleRefereeAssignmentStarting('duty-1', NOW);
    const jobs = queue.add.mock.calls.map((call) => call[1] as { kind: NotificationKind });

    expect(jobs).toMatchObject([{ kind: 'referee_starting', entityId: 'duty-1', userId: 'u-lea' }]);
    await expect(isStillWanted(db as never, jobs[0] as never)).resolves.toBe(true);
  });
});

describe('the worker asks when the alert fires', () => {
  const sender = { send: vi.fn() };
  const delivery = {
    notification_preferences: { rows: [] },
    push_subscriptions: {
      rows: [
        { user_id: 'marc', endpoint: 'https://push.example/1', p256dh_key: 'k', auth_key: 'a' },
        { user_id: 'u-lea', endpoint: 'https://push.example/2', p256dh_key: 'k', auth_key: 'a' },
      ],
    },
  };
  const HIS_BOUT_ALERT = { kind: 'follow_match_starting', entityId: 'bout-1', userId: 'marc' };
  async function fire(overrides: Record<string, TableSeed> = {}, alert = HIS_BOUT_ALERT) {
    sender.send.mockReset();
    const db = mockSupabase({ ...tables(), ...delivery, ...overrides });
    const worker = new NotificationSchedulerWorker(
      db as never,
      new ConfigService({}) as never,
      sender as never,
      { sendNotification: vi.fn() } as never,
    );
    await worker.process({
      id: 'job-1',
      data: { ...alert, title: 'Soon', body: 'Léa fights soon.', url: '/n' },
    } as never);
    return { db, sent: sender.send.mock.calls.length };
  }

  it('sends the alert of a follow that is still saved', async () => {
    expect((await fire()).sent).toBe(1);
  });

  it('drops the alert of a follow that is gone, and says so in the log', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const { db, sent } = await fire(follows());

    expect(sent).toBe(0);
    expect(log).toHaveBeenCalledWith('Dropped follow_match_starting for bout-1: no longer wanted');
    expect(queriedTables(db.from)).not.toContain('push_subscriptions');
  });

  it("asks whether it is public first: a draft's alert reads nobody's follow", async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const draft = { ...bout('bout-1', 'lea', 'tom'), phases: { tournaments: { status: 'draft' } } };

    const { db, sent } = await fire({ matches: { rows: [draft] } });

    expect(sent).toBe(0);
    expect(log).toHaveBeenCalledWith('Dropped follow_match_starting for bout-1: hidden or gone');
    expect(queriedTables(db.from)).toEqual(['matches']);
  });

  it("sends a referee's own alert while his duty is locked", async () => {
    const own = { kind: 'referee_starting', entityId: 'duty-1', userId: 'u-lea' };

    expect((await fire({}, own)).sent).toBe(1);
  });

  it.each<[string, string]>([
    ['referee_starting', 'u-lea'],
    ['follow_referee_starting', 'marc'],
  ])('drops %s of an unlocked duty, and says so in the log (ruling 220)', async (kind, userId) => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const { sent } = await fire({}, { kind, entityId: 'duty-planned', userId });

    expect(sent).toBe(0);
    expect(log).toHaveBeenCalledWith(`Dropped ${kind} for duty-planned: no longer wanted`);
  });
});
