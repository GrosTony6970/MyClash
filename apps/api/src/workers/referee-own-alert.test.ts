/**
 * A referee's own "your duty starts soon" follows his duty (operator ruling 221).
 *
 * It is 9:55. Paul is locked on Pool 3, which starts at 10:00, and on the final at 14:00; his
 * alert is due 10 minutes before. Anna's duty of the morning started at 8:00, and her other one
 * has no bout placed. Zoé's profile is held by no account. The queue holds what each test says:
 * an alert that fired is kept with the start it rang for, and that record is the memory.
 */
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALERT_DROPPED, ALERT_SENT, type HeldAlert } from './duty-alert-rings';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
  type TableSeed,
} from '../common/testing/supabase-chain';
import { holdingQueue } from './follow-notification-scheduler.apply.fixtures';
import { NotificationSchedulerService } from './notification-scheduler.worker';

const at = (hhmm: string) => `2026-05-02T${hhmm}:00.000Z`;
const NOW = new Date(at('09:55'));
const MINUTE = 60_000;

const bout = (id: string, poolId: string | null, scheduledAt: string | null) => ({
  id,
  pool_id: poolId,
  lice_id: null,
  phase_id: 'phase-1',
  scheduled_at: scheduledAt,
  planned_duration_override_minutes: null,
});
const duty = (id: string, profile: string, on: { pool?: string; bout?: string }) => ({
  id,
  person_id: profile,
  event_id: 'event-1',
  pool_id: on.pool ?? null,
  match_id: on.bout ?? null,
  role: 'arbitre_table',
  status: 'confirmed',
  matches: null,
});
const DUTIES = [
  duty('paul-pool-3', 'gp-paul', { pool: 'pool-3' }),
  duty('paul-final', 'gp-paul', { bout: 'final' }),
  duty('anna-morning', 'gp-anna', { bout: 'morning' }),
  duty('anna-unplaced', 'gp-anna', { bout: 'unplaced' }),
  duty('zoe-final', 'gp-zoe', { bout: 'final' }),
];
const TABLES: Record<string, TableSeed> = {
  matches: {
    rows: [
      bout('p3-1', 'pool-3', at('10:05')),
      bout('p3-2', 'pool-3', at('10:00')),
      bout('final', null, at('14:00')),
      bout('morning', null, at('08:00')),
      bout('unplaced', null, null),
    ],
  },
  referee_assignments: { rows: DUTIES },
  global_persons: {
    rows: [
      { id: 'gp-paul', claimed_by_user_id: 'u-paul' },
      { id: 'gp-anna', claimed_by_user_id: 'u-anna' },
      { id: 'gp-zoe', claimed_by_user_id: null },
    ],
  },
  notification_preferences: { rows: [] },
};
const BOOM = { data: null, error: { message: 'boom' } };

const POOL_3 = 'notification.referee_starting.paul-pool-3.u-paul';
const FINAL = 'notification.referee_starting.paul-final.u-paul';
const MORNING = 'notification.referee_starting.anna-morning.u-anna';
const UNPLACED = 'notification.referee_starting.anna-unplaced.u-anna';

const waiting = (startsAt: string): HeldAlert => ({ data: { startsAt } });
const fired = (returnvalue: unknown, startsAt: string): HeldAlert => ({
  finishedOn: 1,
  returnvalue,
  data: { startsAt },
});

function setup(held: Record<string, HeldAlert> = {}, tables: Record<string, TableSeed> = {}) {
  const removed: string[] = [];
  const queue = holdingQueue(held, removed);
  const db = mockSupabase({ ...TABLES, ...tables });
  const service = new NotificationSchedulerService(queue as never, db as never);
  /** What was added, as the queue was asked: id, delay, and how long a fired job is kept. */
  const added = () =>
    queue.add.mock.calls.map(([, , opts]) => opts as { jobId: string; delay: number });
  return { service, queue, db, removed, added };
}
const one = (id: string) => DUTIES.filter((row) => row.id === id);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the lock tells a referee of his duty', () => {
  it('sets the alert of a duty inside its lead time at once, with the start it rings for', async () => {
    const { service, queue, added } = setup();

    await service.scheduleRefereeAssignmentStarting('paul-pool-3', NOW);

    // 10:00 is the Pool's earliest placed bout; its minute, 9:50, has passed.
    expect(added()).toEqual([
      expect.objectContaining({ jobId: POOL_3, delay: 0, removeOnComplete: { age: 86_400 } }),
    ]);
    expect(queue.jobs.get(POOL_3)?.data).toMatchObject({
      kind: 'referee_starting',
      entityId: 'paul-pool-3',
      userId: 'u-paul',
      startsAt: at('10:00'),
    });
  });

  it('sets the alert of a duty still far away at its minute', async () => {
    const { service, added } = setup();

    await service.scheduleRefereeAssignmentStarting('paul-final', NOW);

    // 14:00 less 10 minutes, from 9:55.
    expect(added()).toEqual([expect.objectContaining({ jobId: FINAL, delay: 235 * MINUTE })]);
  });

  it('does nothing for a duty that is gone', async () => {
    const { service, queue } = setup();

    await service.scheduleRefereeAssignmentStarting('duty-gone', NOW);

    expect(queue.getJob).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('an alert that rang does not ring again for the same start (ruling 221)', () => {
  it.each<[string, unknown]>([
    ['was sent', ALERT_SENT],
    ['failed: the live phones rang before the dead one threw', null],
  ])('keeps the record of an alert that %s, and sets nothing', async (_, answer) => {
    const { service, queue, removed } = setup({ [POOL_3]: fired(answer, at('10:00')) });

    await service.scheduleRefereeDutiesStarting(one('paul-pool-3'), NOW);

    expect(queue.add).not.toHaveBeenCalled();
    expect(removed).toEqual([]);
    expect(queue.jobs.get(POOL_3)?.finishedOn).toBe(1);
  });

  it.each<[string, HeldAlert]>([
    ['was dropped at its minute: an unlocked board, or a draft', fired(ALERT_DROPPED, at('10:00'))],
    ['rang for another start: the duty moved', fired(ALERT_SENT, at('09:58'))],
    ['still waits for an older start', waiting(at('11:00'))],
  ])('sets it again when the one held %s', async (_, held) => {
    const { service, queue, removed, added } = setup({ [POOL_3]: held });

    await service.scheduleRefereeDutiesStarting(one('paul-pool-3'), NOW);

    // Removed first: an add under an id still held is ignored.
    expect(removed).toEqual([POOL_3]);
    expect(added()).toEqual([expect.objectContaining({ jobId: POOL_3, delay: 0 })]);
    expect(queue.jobs.get(POOL_3)).toEqual({
      data: expect.objectContaining({ startsAt: at('10:00') }),
    });
  });
});

describe('a duty that rings for nobody loses the alert that waits, and keeps one that fired', () => {
  it.each<[string, string, string, Record<string, TableSeed>]>([
    ['has started', 'anna-morning', MORNING, {}],
    ['has no bout placed', 'anna-unplaced', UNPLACED, {}],
    [
      'is of an account whose main switch is off: it would ring at an old minute once back on',
      'paul-final',
      FINAL,
      { notification_preferences: { rows: [{ user_id: 'u-paul', enabled: false }] } },
    ],
  ])('a duty that %s', async (_, dutyId, jobId, tables) => {
    const waits = setup({ [jobId]: waiting(at('07:00')) }, tables);
    await waits.service.scheduleRefereeDutiesStarting(one(dutyId), NOW);
    expect(waits.removed).toEqual([jobId]);
    expect(waits.queue.add).not.toHaveBeenCalled();

    const rang = setup({ [jobId]: fired(ALERT_SENT, at('07:00')) }, tables);
    await rang.service.scheduleRefereeDutiesStarting(one(dutyId), NOW);
    expect(rang.removed).toEqual([]);
    expect(rang.queue.add).not.toHaveBeenCalled();
  });
});

describe('many duties at once: a retime of the bouts hands every locked duty they start', () => {
  it('sets each account its own alerts, reading the holders, the switches and the bouts in sets', async () => {
    const { service, db, added } = setup();

    await service.scheduleRefereeDutiesStarting(DUTIES, NOW);

    // Anna's two duties ring for nobody; Zoé has no account.
    expect(
      added()
        .map((job) => job.jobId)
        .sort(),
    ).toEqual([FINAL, POOL_3]);
    expect(queriedTables(db.from).sort()).toEqual([
      'global_persons',
      // The bouts: once by bout, once by Pool.
      'matches',
      'matches',
      'notification_preferences',
    ]);
    expect(selectsFor(db.from, 'global_persons')).toEqual(['id, claimed_by_user_id']);
    expect(filtersFor(db.from, 'global_persons', 'in')).toEqual([
      ['id', ['gp-paul', 'gp-anna', 'gp-zoe']],
    ]);
    expect(filtersFor(db.from, 'notification_preferences', 'in')).toEqual([
      ['user_id', ['u-paul', 'u-anna']],
    ]);
  });

  it('reads no bout, and asks the queue nothing, for a referee no account holds', async () => {
    const { service, queue, db } = setup();

    await service.scheduleRefereeDutiesStarting(one('zoe-final'), NOW);

    expect(queriedTables(db.from)).toEqual(['global_persons']);
    expect(queue.getJob).not.toHaveBeenCalled();
  });

  it.each<[string, string]>([
    [
      'global_persons',
      'Holders of 1 referee profile(s) unreadable; their reminders are left as they were: boom',
    ],
    [
      'matches',
      'Referee assignment paul-final: its Matches are unreadable; its reminder is left as it was: boom',
    ],
  ])('a failed read of %s is said once, and leaves the alert as it was', async (table, said) => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, queue, removed } = setup({ [FINAL]: waiting(at('16:00')) }, { [table]: BOOM });

    await service.scheduleRefereeDutiesStarting(one('paul-final'), NOW);

    expect(warn.mock.calls).toEqual([[said]]);
    expect(removed).toEqual([]);
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('the memory is for duty alerts alone', () => {
  it("a Fighter's bout alert that fired still leaves the queue", async () => {
    const { service, added } = setup();

    await service.scheduleReminder({
      kind: 'match_starting',
      entityId: 'final',
      userId: 'u-paul',
      startsAt: at('14:00'),
      leadMinutes: 10,
      title: 't',
      body: 'b',
      url: '/n',
      now: NOW,
    });

    expect(added()).toEqual([expect.objectContaining({ removeOnComplete: true })]);
  });
});
