import { afterEach, describe, expect, it, vi } from 'vitest';
import { filtersFor, selectsFor } from '../common/testing/supabase-chain';
import {
  ALL_OFF,
  HER_WORKSHOPS,
  HIS_ALERTS,
  HIS_BOUT,
  HIS_DUTY,
  HIS_SESSION,
  NOW,
  at,
  follow,
  setup,
  teaches,
} from './follow-notification-scheduler.apply.fixtures';

/**
 * One follower's waiting alerts follow his follows as saved (rulings 207, 209).
 *
 * Marc follows Léa on Saturday morning. Her bouts were timed on Friday, and an alert used to be set
 * only when a time changed: he heard nothing. A switch turned off left its alert waiting. And an
 * alert is one job per bout and follower: removing "her" alert must not remove Tom's.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a follower's alerts follow his follows as saved", () => {
  it('a follow of her bouts sets his alert for the one still ahead, and nobody else is touched', async () => {
    const marc = follow('marc', { notify_referee_start: false, notify_workshop_start: false });
    const { service, set, gone } = setup({ follows: { rows: [marc, follow('nina')] } });

    await service.applyFollow('lea', 'marc', NOW);

    // Not the bout fought an hour ago, not the one with no time, not Zoé's, and nothing of Nina's.
    expect(set()).toEqual([HIS_BOUT]);
    expect(gone()).toEqual(HIS_ALERTS);
  });

  it('every switch on sets her locked duty and her Workshop of this Event too', async () => {
    const { service, db, set } = setup();

    await service.applyFollow('lea', 'marc', NOW);

    // Not the duty still being planned: its referee has not been told either.
    expect(set()).toEqual([HIS_BOUT, HIS_DUTY, HIS_SESSION]);
    // The canned table answers any filter: her Workshops are asked for by her profile.
    expect(filtersFor(db.from, 'workshop_instructors', 'eq')).toContainEqual([
      'global_person_id',
      'gp-lea',
    ]);
  });

  it('an unfollow removes his waiting alerts about her, and sets none', async () => {
    const { service, set, gone } = setup({ follows: { rows: [follow('nina')] } });

    await service.applyFollow('lea', 'marc', NOW);

    expect(gone()).toEqual(HIS_ALERTS);
    expect(set()).toEqual([]);
  });

  it('a switch turned off removes its alert, and the other two stay set', async () => {
    const marc = follow('marc', { notify_match_start: false });
    const { service, set, gone } = setup({ follows: { rows: [marc] } });

    await service.applyFollow('lea', 'marc', NOW);

    expect(gone()).toEqual(HIS_ALERTS);
    expect(set()).toEqual([HIS_DUTY, HIS_SESSION]);
  });

  it('walks her entries, bouts, profile, duties and Workshops by columns the tables have', async () => {
    const { service, db } = setup({ follows: { rows: [] } });

    await service.applyFollow('lea', 'marc', NOW);

    // The double ignores a projection: only a pin sees a column a table does not have.
    const asked = (table: string) => selectsFor(db.from, table);
    expect(asked('registrations')[0]).toBe('id');
    expect(asked('matches')[0]).toBe('id');
    expect(asked('persons')[0]).toBe('global_person_id, event_id');
    expect(asked('referee_assignments')[0]).toBe('id');
    expect(asked('workshop_instructors')[0]).toBe('workshop_id');
    expect(asked('workshops')).toEqual(['id']);
    expect(asked('workshop_sessions')[0]).toBe('id');
  });
});

describe('an alert is one job per bout and follower, whoever he follows in it', () => {
  it.each<[string, Array<ReturnType<typeof follow>>]>([
    ['muting Léa', [follow('marc', ALL_OFF), follow('marc', {}, 'tom')]],
    ['unfollowing Léa', [follow('marc', {}, 'tom')]],
  ])('%s keeps the alert of her bout against Tom, whom he follows too', async (_, rows) => {
    const { service, set, bodyOf } = setup({ follows: { rows } });

    await service.applyFollow('lea', 'marc', NOW);

    expect(set()).toEqual([HIS_BOUT]);
    expect(bodyOf(HIS_BOUT)).toContain('tom Roux fights in 10 min - Pool A vs lea Roux');
  });

  it('muting Léa keeps the alert of the Workshop she teaches with Tom, whom he follows too', async () => {
    const { service, set, bodyOf } = setup({
      follows: { rows: [follow('marc', ALL_OFF), follow('marc', {}, 'tom')] },
      workshop_instructors: {
        data: [...HER_WORKSHOPS, teaches('workshop-1', 'gp-tom')],
        error: null,
      },
    });

    await service.applyFollow('lea', 'marc', NOW);

    expect(set()).toEqual([HIS_BOUT, HIS_SESSION]);
    expect(bodyOf(HIS_SESSION)).toContain('Longsword with Tom Roux starts in 15 min.');
  });
});

describe('an empty follower id is nobody, not everybody', () => {
  it('sets no alert, for a bout, a duty or a Workshop', async () => {
    const { service, set } = setup();

    await service.scheduleMatchStartingMany(['bout-ahead'], NOW, '');
    await service.scheduleRefereeStarting('duty-1', NOW, '');
    await service.scheduleWorkshopStarting('session-1', NOW, '');

    expect(set()).toEqual([]);
  });
});

describe('what has already started rings for nobody', () => {
  it.each<[string, string, Date]>([
    ['a time that has passed', 'bout-fought', NOW],
    ['this very minute', 'bout-ahead', new Date(at('10:30'))],
  ])('a bout moved to %s loses its waiting alert, and gets no new one', async (_, id, now) => {
    const { service, set, gone } = setup();

    await service.scheduleMatchStarting(id, now);

    expect(gone()).toEqual([
      `follow.match_starting.${id}.marc`,
      `follow.match_starting.${id}.nina`,
    ]);
    expect(set()).toEqual([]);
  });
});
