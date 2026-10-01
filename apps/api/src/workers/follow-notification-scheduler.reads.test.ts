import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor } from '../common/testing/supabase-chain';
import { FollowNotificationSchedulerService } from './follow-notification-scheduler.worker';

/**
 * The four reads behind "a Fighter you follow starts soon".
 *
 * The bout read asked for `lices ( name, label )`. The lices table has no `label` column, so
 * PostgREST refused the whole read (400, `column lices_1.label does not exist`), the error was
 * dropped, and no follower was ever told. The double below ignores a projection, so only a pin on
 * the string sees such a column; and only a warning shows a read that failed.
 */

const NOW = new Date('2026-05-02T10:00:00.000Z');
const REFUSED = { data: null, error: { message: 'column lices_1.label does not exist' } };

const bout = (id: string, red: string, blue: string) => ({
  id,
  match_number_label: 'L1-P1-M1',
  scheduled_at: '2026-05-02T10:30:00.000Z',
  red_registration_id: `reg-${red}`,
  blue_registration_id: `reg-${blue}`,
  lices: { name: 'Lice 1' },
  pools: { name: 'Pool A' },
});
const entry = (id: string, given: string, family: string) => ({
  id: `reg-${id}`,
  person_id: id,
  persons: { given_name: given, family_name: family },
});
const follow = (follower: string, followed: string, notify = true) => ({
  followed_person_id: followed,
  follower_user_id: follower,
  notify_match_start: notify,
});

/**
 * Seeded tables, so the filters count. Marc follows Léa, who fights Tom in `match-1`. The decoys:
 * Nina follows Zoé, whose bout is not the one asked about; Paul follows Tom with the alert off.
 */
const READS = {
  matches: { rows: [bout('match-1', 'lea', 'tom'), bout('match-2', 'zoe', 'ana')] },
  registrations: {
    rows: [
      entry('lea', 'Léa', 'Roux'),
      entry('tom', 'Tom', 'Petit'),
      entry('zoe', 'Zoé', 'Blanc'),
      entry('ana', 'Ana', 'Noir'),
    ],
  },
  follows: { rows: [follow('marc', 'lea'), follow('nina', 'zoe'), follow('paul', 'tom', false)] },
  notification_preferences: { rows: [] },
};

function setup(reads: Record<string, unknown> = {}) {
  const queue = {
    add: vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn().mockResolvedValue(null),
  };
  const db = mockSupabase({ ...READS, ...reads } as Parameters<typeof mockSupabase>[0]);
  const service = new FollowNotificationSchedulerService(queue as never, db as never);
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  return { queue, db, service, warn };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the reads of the followed-Fighter alert', () => {
  it('ask for columns the tables have: the piste by its name, and no label', async () => {
    const { queue, db, service, warn } = setup();

    await service.scheduleMatchStarting('match-1', NOW);

    expect(selectsFor(db.from, 'matches')).toEqual([
      'id, match_number_label, scheduled_at, red_registration_id, blue_registration_id, lices ( name ), pools ( name )',
    ]);
    expect(selectsFor(db.from, 'registrations')).toEqual([
      'id, person_id, persons ( given_name, family_name )',
    ]);
    expect(selectsFor(db.from, 'follows')).toEqual([
      'followed_person_id, follower_user_id, notify_match_start',
    ]);
    expect(selectsFor(db.from, 'notification_preferences')).toEqual([
      'user_id, enabled, match_starting_minutes_before, referee_starting_minutes_before, workshop_starting_minutes_before',
    ]);
    // Marc follows Léa: he is told about her bout, on the piste by its name.
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0]?.[1]).toMatchObject({
      userId: 'marc',
      body: expect.stringContaining(
        'Léa Roux combat dans 10 min - Pool A contre Tom Petit sur Lice 1.',
      ),
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each<[string, string]>([
    ['matches', 'Bouts unreadable; their follower alerts stay as they were'],
    ['registrations', 'Fighters of the bouts unreadable; their follower alerts stay as they were'],
    ['follows', 'Followers unreadable; their alerts stay as they were'],
  ])('a refused read of %s sets no alert, and the log says why', async (table, failure) => {
    const { queue, service, warn } = setup({ [table]: REFUSED });

    await service.scheduleMatchStarting('match-1', NOW);

    expect(queue.add).not.toHaveBeenCalled();
    expect(warn.mock.calls).toEqual([[`${failure}: column lices_1.label does not exist`]]);
  });

  it('a refused read of the switches still sets the alert, at the usual lead, and the log says why', async () => {
    const { queue, service, warn } = setup({ notification_preferences: REFUSED });

    await service.scheduleMatchStarting('match-1', NOW);

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0]?.[2]).toMatchObject({ delay: 20 * 60_000 });
    expect(warn.mock.calls).toEqual([
      ['Follower switches unreadable, taken as never saved: column lices_1.label does not exist'],
    ]);
  });
});
