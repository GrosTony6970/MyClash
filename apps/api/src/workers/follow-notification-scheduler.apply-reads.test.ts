import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BOOM,
  HIS_DUTY,
  HIS_SESSION,
  NOW,
  setup,
} from './follow-notification-scheduler.apply.fixtures';

/**
 * What a failed read does to a follower's alerts (rulings 207, 209).
 *
 * `applyFollow` removes one follower's alerts and sets them again: for him a read that fails must
 * fail the call, or his alerts would stay removed behind a 200. A retime stays best effort.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('for one follower nothing is best effort: his alerts were removed just before', () => {
  it.each<[string, string]>([
    // The walk.
    ['registrations', 'Entries of a followed person unreadable: boom'],
    ['matches', 'Bouts of a followed person unreadable: boom'],
    ['persons', 'Followed person unreadable: boom'],
    ['referee_assignments', 'Duties of a followed person unreadable: boom'],
    ['workshop_instructors', 'Workshops of a followed instructor unreadable: boom'],
    ['workshops', "Workshops of a follow's Event unreadable: boom"],
    ['workshop_sessions', 'Sessions of a followed instructor unreadable: boom'],
    // The reads that set the alerts again.
    ['follows', 'Followers unreadable: boom'],
    ['notification_preferences', 'Follower switches unreadable: boom'],
    ['global_persons', 'Name of a referee unreadable: boom'],
  ])('a failed read of %s is an error, not "nothing to set"', async (table, message) => {
    const { service } = setup({ [table]: BOOM });

    await expect(service.applyFollow('lea', 'marc', NOW)).rejects.toThrow(
      new RegExp(`^${message}$`),
    );
  });

  type Schedule = 'scheduleRefereeStarting' | 'scheduleWorkshopStarting';
  it.each<[Schedule | 'scheduleMatchStartingMany', string, string, string]>([
    ['scheduleMatchStartingMany', 'bout-ahead', 'matches', 'Bouts unreadable: boom'],
    ['scheduleMatchStartingMany', 'bout-ahead', 'registrations', 'Fighters of the bouts'],
    ['scheduleRefereeStarting', 'duty-1', 'referee_assignments', 'assignment duty-1 unreadable'],
    ['scheduleRefereeStarting', 'duty-1', 'persons', 'Roster rows of a referee unreadable: boom'],
    ['scheduleRefereeStarting', 'duty-1', 'follows', 'Followers of a referee unreadable: boom'],
    ['scheduleRefereeStarting', 'duty-1', 'matches', 'duty-1: its Matches are unreadable: boom'],
    ['scheduleWorkshopStarting', 'session-1', 'workshop_sessions', 'session-1 unreadable: boom'],
    ['scheduleWorkshopStarting', 'session-1', 'workshop_instructors', 'Instructors of a Workshop'],
    ['scheduleWorkshopStarting', 'session-1', 'persons', 'Roster rows of the instructors'],
    ['scheduleWorkshopStarting', 'session-1', 'follows', 'Followers of an instructor unreadable'],
    ['scheduleWorkshopStarting', 'session-1', 'global_persons', 'Names of the instructors'],
  ])('%s of %s for him throws when %s cannot be read', async (method, id, table, message) => {
    const { service, set } = setup({ [table]: BOOM });

    const call =
      method === 'scheduleMatchStartingMany'
        ? service.scheduleMatchStartingMany([id], NOW, 'marc')
        : service[method](id, NOW, 'marc');
    const failure = await call.then(
      () => null,
      (error: unknown) => error,
    );

    // A plain Error is a 5xx: a failed read of a duty's Matches is a 400 where it is thrown.
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).constructor).toBe(Error);
    expect((failure as Error).message).toContain(message);
    expect(set()).toEqual([]);
  });

  it('a job the queue cannot remove fails the call', async () => {
    const { service, queue } = setup();
    queue.getJob.mockResolvedValue({
      remove: async () => {
        throw new Error('job is being sent');
      },
    } as never);

    await expect(service.applyFollow('lea', 'marc', NOW)).rejects.toThrow('job is being sent');
  });
});

describe('a retime is best effort: a read that fails is logged', () => {
  type Schedule = 'scheduleRefereeStarting' | 'scheduleWorkshopStarting';
  const NONE_SET = 'no follower reminder set: boom';
  it.each<[Schedule, string, string, string]>([
    ['scheduleRefereeStarting', 'duty-1', 'persons', 'Roster rows of a referee unreadable'],
    ['scheduleRefereeStarting', 'duty-1', 'follows', 'Followers of a referee unreadable'],
    [
      'scheduleWorkshopStarting',
      'session-1',
      'workshop_sessions',
      'Workshop session session-1 unreadable',
    ],
    [
      'scheduleWorkshopStarting',
      'session-1',
      'workshop_instructors',
      'Instructors of a Workshop unreadable',
    ],
    [
      'scheduleWorkshopStarting',
      'session-1',
      'persons',
      'Roster rows of the instructors unreadable',
    ],
    ['scheduleWorkshopStarting', 'session-1', 'follows', 'Followers of an instructor unreadable'],
  ])('%s of %s with %s unreadable sets nothing, and says so', async (method, id, table, said) => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, set } = setup({ [table]: BOOM });

    await service[method](id, NOW);

    expect(set()).toEqual([]);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([`${said}; ${NONE_SET}`]);
  });

  it.each<[Schedule, string, string, string, string]>([
    [
      'scheduleRefereeStarting',
      'duty-1',
      HIS_DUTY,
      'A followed referee referees in 10 min',
      'Name of a referee unreadable',
    ],
    [
      'scheduleWorkshopStarting',
      'session-1',
      HIS_SESSION,
      'Longsword with A followed instructor starts in 15 min.',
      'Names of the instructors unreadable',
    ],
  ])('%s of %s says a stand-in for a name it cannot read', async (method, id, job, body, said) => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, bodyOf } = setup({ global_persons: BOOM });

    await service[method](id, NOW);

    expect(bodyOf(job)).toContain(body);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      `${said}; a stand-in is said: boom`,
    ]);
  });
});
