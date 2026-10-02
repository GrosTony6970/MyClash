/**
 * A hub follow rings before a referee's duties (operator rulings 217, 217a, 217b).
 *
 * Paul referees at the Open, taken from the directory: he has no roster row there. Marc follows
 * him from the People hub and turned the hub switch on; Nina follows him too, her switch still
 * off. Who is alerted is `referee-alert-followers.ts` (tested there); these hold the scheduler's
 * two doors: the lock of a duty, and a change of the hub follow (`applyHubFollow`).
 */
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { filtersFor, queriedTables, selectsFor } from '../common/testing/supabase-chain';
import { BOOM, NOW, setup } from './follow-notification-scheduler.apply.fixtures';

const duty = (
  id: string,
  profile: string,
  eventId: string,
  events: unknown,
  status = 'confirmed',
) => ({
  id,
  person_id: profile,
  event_id: eventId,
  match_id: 'bout-of-zoe',
  status,
  events,
});
const hubFollow = (follower: string, on: boolean, profile = 'gp-paul') => ({
  follower_user_id: follower,
  followed_global_person_id: profile,
  notify_referee_start: on,
});

/**
 * Paul's duties: one locked at the Open, one still being planned there, one in an Event that is
 * completed, one in an archived Event and one in a TEST Event. Léa's duty is not his.
 */
const world = (hub = [hubFollow('marc', true), hubFollow('nina', false)]) => ({
  referee_assignments: {
    rows: [
      duty('paul-open', 'gp-paul', 'event-1', { status: 'published' }),
      duty('paul-planned', 'gp-paul', 'event-1', { status: 'published' }, 'assigned'),
      duty('paul-past', 'gp-paul', 'event-8', { status: 'completed' }),
      // The typed client hands a to-one embed as an array.
      duty('paul-archived', 'gp-paul', 'event-9', [{ status: 'archived' }]),
      duty('lea-open', 'gp-lea', 'event-1', { status: 'published' }),
      duty('paul-rehearsal', 'gp-paul', 'event-test', { status: 'published' }),
    ],
  },
  directory_follows: { rows: hub },
  events: {
    rows: [
      { id: 'event-1', event_kind: 'standard', organization_id: 'org-1' },
      { id: 'event-test', event_kind: 'test', organization_id: 'org-1' },
    ],
  },
  // Nina is a member of the club that runs both Events; Marc is not.
  organization_members: { rows: [{ organization_id: 'org-1', user_id: 'nina' }] },
  global_persons: { rows: [{ id: 'gp-paul', display_name: 'Paul Blanc' }] },
});

const HIS = 'follow.referee_starting.paul-open.marc';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the lock of a duty of a referee with no roster row', () => {
  it('sets the alert of the hub follower whose switch is on, and of nobody else', async () => {
    const { service, set, bodyOf } = setup(world());

    await service.scheduleRefereeStarting('paul-open', NOW);

    expect(set()).toEqual([HIS]);
    expect(bodyOf(HIS)).toBe('Paul Blanc officie dans 10 min. / Paul Blanc referees in 10 min.');
  });

  it('sets none while every hub switch is off, as it is at first', async () => {
    const { service, set } = setup(world([hubFollow('marc', false), hubFollow('nina', false)]));

    await service.scheduleRefereeStarting('paul-open', NOW);

    expect(set()).toEqual([]);
  });

  it('in a TEST Event, sets it for a member of the Event’s club only (ruling 217c)', async () => {
    const { service, set } = setup(world([hubFollow('marc', true), hubFollow('nina', true)]));

    await service.scheduleRefereeStarting('paul-rehearsal', NOW);

    expect(set()).toEqual(['follow.referee_starting.paul-rehearsal.nina']);
  });

  it('still sets the Event followers’ alerts when the hub follows cannot be read, and the log says who is not told', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    // Léa has a roster row at the Open, and Marc follows it with every switch on.
    const { service, set } = setup({ ...world(), directory_follows: BOOM });

    await service.scheduleRefereeStarting('lea-open', NOW);

    expect(set()).toEqual([
      'follow.referee_starting.lea-open.marc',
      'follow.referee_starting.lea-open.nina',
    ]);
    expect(warn.mock.calls).toEqual([
      ['Hub followers of a referee unreadable; the hub followers get no reminder: boom'],
    ]);
  });

  it('sets none when the roster rows cannot be read, and the log says why', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, set } = setup({ ...world(), persons: BOOM });

    await service.scheduleRefereeStarting('paul-open', NOW);

    expect(set()).toEqual([]);
    expect(warn.mock.calls).toEqual([
      ['Roster rows of a referee unreadable; no follower reminder set: boom'],
    ]);
  });
});

describe('a change of the hub follow acts at once: remove, then set from the saved rows', () => {
  it('removes each follower’s alerts about his duties in the Events not over, and sets the wanted one', async () => {
    const { service, gone, set } = setup(world());

    await service.applyHubFollow('gp-paul', ['marc', 'nina'], NOW);

    // Not the completed Event, not the archived one, not Léa's duty.
    expect(gone()).toEqual([
      HIS,
      'follow.referee_starting.paul-open.nina',
      'follow.referee_starting.paul-planned.marc',
      'follow.referee_starting.paul-planned.nina',
      'follow.referee_starting.paul-rehearsal.marc',
      'follow.referee_starting.paul-rehearsal.nina',
    ]);
    expect(set()).toEqual([HIS]);
  });

  it('a switch saved as off removes his alert and sets none', async () => {
    const { service, gone, set } = setup(world([hubFollow('marc', false)]));

    await service.applyHubFollow('gp-paul', ['marc'], NOW);

    expect(gone()).toContain(HIS);
    expect(set()).toEqual([]);
  });

  it('walks his duties by columns the table has, and his alone', async () => {
    const { service, db } = setup(world());

    await service.applyHubFollow('gp-paul', ['marc'], NOW);

    expect(selectsFor(db.from, 'referee_assignments')[0]).toBe('id, events ( status )');
    expect(filtersFor(db.from, 'referee_assignments', 'eq')[0]).toEqual(['person_id', 'gp-paul']);
  });

  it('reads nothing when there is no follower to bring in line', async () => {
    const { service, db, gone } = setup(world());

    await service.applyHubFollow('gp-paul', [], NOW);

    expect(queriedTables(db.from)).toEqual([]);
    expect(gone()).toEqual([]);
  });

  it.each<[string, string]>([
    ['referee_assignments', 'Duties of a followed referee unreadable: boom'],
    ['directory_follows', 'Hub followers of a referee unreadable: boom'],
    ['persons', 'Roster rows of a referee unreadable: boom'],
  ])('a failed read of %s is an error, not "nothing to set"', async (table, message) => {
    const { service } = setup({ ...world(), [table]: BOOM });

    const failure = await service.applyHubFollow('gp-paul', ['marc'], NOW).then(
      () => null,
      (error: unknown) => error,
    );

    expect((failure as Error | null)?.constructor).toBe(Error);
    expect((failure as Error).message).toBe(message);
  });
});
