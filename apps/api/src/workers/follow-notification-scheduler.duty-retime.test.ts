/**
 * A follower's "someone you follow is about to referee" follows the duty (operator ruling 221).
 *
 * It is 10:00. Léa is locked on Zoé's bout at 11:00; Marc and Nina follow her, and their alert is
 * due 10 minutes before. The queue holds what each test says: an alert that fired is kept with
 * the start it rang for, and that record is the memory. A removed job is gone, and an add under
 * an id still held is ignored, as on the real queue.
 */
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queriedTables } from '../common/testing/supabase-chain';
import { ALERT_DROPPED, ALERT_SENT, type HeldAlert } from './duty-alert-rings';
import {
  at,
  BOOM,
  follow,
  HIS_DUTY,
  NOW,
  setup,
} from './follow-notification-scheduler.apply.fixtures';

const HERS = 'follow.referee_starting.duty-1.nina';
const MINUTE = 60_000;

const waiting = (startsAt: string): HeldAlert => ({ data: { startsAt } });
const fired = (returnvalue: unknown, startsAt: string): HeldAlert => ({
  finishedOn: 1,
  returnvalue,
  data: { startsAt },
});
/** Zoé's bout, the one Léa referees, at another time. */
const zoesBout = (scheduledAt: string | null) => ({
  matches: {
    rows: [
      {
        id: 'bout-of-zoe',
        match_number_label: 'bout-of-zoe',
        scheduled_at: scheduledAt,
        pool_id: null,
        lice_id: 'lice-1',
        phase_id: 'phase-1',
        planned_duration_override_minutes: null,
      },
    ],
  },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a retime sets each follower's alert at the duty's start", () => {
  it('sets it with the start it rings for, and keeps it a day once it has fired', async () => {
    const { service, queue } = setup({}, {});

    await service.scheduleRefereeStarting('duty-1', NOW);

    // 11:00 less 10 minutes, from 10:00.
    expect(queue.add.mock.calls.map(([, , opts]) => opts)).toEqual([
      expect.objectContaining({
        jobId: HIS_DUTY,
        delay: 50 * MINUTE,
        removeOnComplete: { age: 86_400 },
      }),
      expect.objectContaining({
        jobId: HERS,
        delay: 50 * MINUTE,
        removeOnComplete: { age: 86_400 },
      }),
    ]);
    expect(queue.jobs.get(HIS_DUTY)?.data).toMatchObject({
      kind: 'follow_referee_starting',
      entityId: 'duty-1',
      userId: 'marc',
      startsAt: at('11:00'),
    });
  });

  it("a bout's follower alert that fired still leaves the queue", async () => {
    const { service, queue } = setup({}, {});

    await service.scheduleMatchStartingMany(['bout-ahead'], NOW);

    expect(queue.add.mock.calls.map(([, , opts]) => opts)).toEqual([
      expect.objectContaining({ removeOnComplete: true }),
      expect.objectContaining({ removeOnComplete: true }),
    ]);
  });
});

describe('an alert that rang does not ring again for the same start (ruling 221)', () => {
  it.each<[string, unknown]>([
    ['was sent', ALERT_SENT],
    ['failed', null],
  ])(
    'keeps the record of an alert that %s, and still sets the other follower’s',
    async (_, answer) => {
      const { service, queue, set, gone } = setup({}, { [HIS_DUTY]: fired(answer, at('11:00')) });

      await service.scheduleRefereeStarting('duty-1', NOW);

      expect(set()).toEqual([HERS]);
      expect(gone()).toEqual([]);
      expect(queue.jobs.get(HIS_DUTY)?.finishedOn).toBe(1);
    },
  );

  it.each<[string, HeldAlert]>([
    ['was dropped at its minute', fired(ALERT_DROPPED, at('11:00'))],
    ['rang for another start: the duty moved', fired(ALERT_SENT, at('10:05'))],
    ['still waits for an older start', waiting(at('12:00'))],
  ])('sets it again when the one held %s', async (_, held) => {
    const { service, queue, gone } = setup({}, { [HIS_DUTY]: held });

    await service.scheduleRefereeStarting('duty-1', NOW);

    // Removed first: an add under an id still held is ignored.
    expect(gone()).toEqual([HIS_DUTY]);
    expect(queue.jobs.get(HIS_DUTY)).toEqual({
      data: expect.objectContaining({ startsAt: at('11:00') }),
    });
  });
});

describe('a duty that rings for nobody loses the alerts that wait, and keeps one that fired', () => {
  it.each<[string, string | null]>([
    ['has no bout placed', null],
    ['has started', at('09:00')],
  ])('a duty that %s', async (_, scheduledAt) => {
    const held = { [HIS_DUTY]: waiting(at('11:00')), [HERS]: fired(ALERT_SENT, at('11:00')) };
    const { service, queue, set, gone } = setup(zoesBout(scheduledAt), held);

    await service.scheduleRefereeStarting('duty-1', NOW);

    expect(set()).toEqual([]);
    expect(gone()).toEqual([HIS_DUTY]);
    expect(queue.jobs.get(HERS)?.finishedOn).toBe(1);
  });

  it('a follower whose main switch is off: his waiting alert goes, the other is set', async () => {
    const off = { notification_preferences: { rows: [{ user_id: 'marc', enabled: false }] } };
    const { service, queue, gone } = setup(off, { [HIS_DUTY]: waiting(at('12:00')) });

    await service.scheduleRefereeStarting('duty-1', NOW);

    expect(gone()).toEqual([HIS_DUTY]);
    expect([...queue.jobs.keys()]).toEqual([HERS]);
  });

  it('bouts that cannot be read at a retime are said once, and nothing is touched', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, set, gone } = setup({ matches: BOOM }, { [HIS_DUTY]: waiting(at('12:00')) });

    await service.scheduleRefereeStarting('duty-1', NOW);

    expect(warn.mock.calls).toEqual([
      ['Referee assignment duty-1: its Matches are unreadable; no follower reminder set: boom'],
    ]);
    expect(set()).toEqual([]);
    expect(gone()).toEqual([]);
  });
});

describe('a change of a follow keeps the memory', () => {
  it('does not ring a second time for the same start: the fired alert is spared', async () => {
    const { service, queue, set, gone } = setup({}, { [HIS_DUTY]: fired(ALERT_SENT, at('11:00')) });

    await service.applyFollow('lea', 'marc', NOW);

    expect(set()).not.toContain(HIS_DUTY);
    expect(gone()).not.toContain(HIS_DUTY);
    expect(queue.jobs.get(HIS_DUTY)?.finishedOn).toBe(1);
  });

  it('removes an alert that still waits and sets it from the saved follow, as before', async () => {
    const { service, queue, gone } = setup({}, { [HIS_DUTY]: waiting(at('12:00')) });

    await service.applyFollow('lea', 'marc', NOW);

    expect(gone()).toContain(HIS_DUTY);
    expect(queue.jobs.get(HIS_DUTY)?.data).toMatchObject({ startsAt: at('11:00') });
  });
});

describe('many duties at once', () => {
  const row = (id: string, profile: string, boutId: string, eventId = 'event-1') => ({
    id,
    person_id: profile,
    event_id: eventId,
    pool_id: null,
    match_id: boutId,
    role: null,
    status: 'confirmed',
    matches: null,
  });

  it('asks who follows each referee once per Event, and reads the bouts, the switches and the names once', async () => {
    // Marc follows Tom too. Léa has two duties at the Open, Tom one. Léa also referees in a second
    // Event, where Omar alone follows her.
    const { service, db, set, bodyOf } = setup(
      {
        persons: {
          rows: [
            { id: 'lea', global_person_id: 'gp-lea', event_id: 'event-1' },
            { id: 'tom', global_person_id: 'gp-tom', event_id: 'event-1' },
            { id: 'lea-2', global_person_id: 'gp-lea', event_id: 'event-2' },
          ],
        },
        follows: {
          rows: [
            follow('marc'),
            follow('nina'),
            follow('marc', {}, 'tom'),
            follow('omar', {}, 'lea-2'),
          ],
        },
      },
      {},
    );

    await service.scheduleRefereeDutiesStarting(
      [
        row('duty-1', 'gp-lea', 'bout-of-zoe'),
        row('duty-2', 'gp-lea', 'bout-ahead'),
        row('duty-elsewhere', 'gp-lea', 'bout-of-zoe', 'event-2'),
        row('duty-of-tom', 'gp-tom', 'bout-of-zoe'),
      ],
      NOW,
    );

    // Each duty rings for the followers of ITS referee in ITS Event, and names its own referee.
    expect(set()).toEqual([
      'follow.referee_starting.duty-1.marc',
      'follow.referee_starting.duty-1.nina',
      'follow.referee_starting.duty-2.marc',
      'follow.referee_starting.duty-2.nina',
      'follow.referee_starting.duty-elsewhere.omar',
      'follow.referee_starting.duty-of-tom.marc',
    ]);
    expect(bodyOf('follow.referee_starting.duty-of-tom.marc')).toContain('Tom Roux referees');
    expect(bodyOf('follow.referee_starting.duty-elsewhere.omar')).toContain('Léa Roux referees');
    const reads = queriedTables(db.from);
    const count = (table: string) => reads.filter((name) => name === table).length;
    // Léa at the Open, Léa elsewhere, Tom: roster rows, Event follows and hub follows, three times.
    expect([count('persons'), count('follows'), count('directory_follows')]).toEqual([3, 3, 3]);
    expect([count('matches'), count('notification_preferences'), count('global_persons')]).toEqual([
      1, 1, 1,
    ]);
  });
});
