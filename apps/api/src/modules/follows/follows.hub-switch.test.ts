/**
 * The hub follow's switch "notify when refereeing" (operator rulings 217, 217a, 217b).
 *
 * Marc follows Paul from the People hub. Paul referees from the directory, with no roster row in
 * the Event, so no Event follow can ask for his duties. The hub follow carries its own switch:
 * `PATCH me/follows/by-global-person/:globalPersonId` saves it, and it acts at once (as ruling
 * 209): the scheduler brings Marc's waiting alerts about Paul's duties in line with the rows as
 * SAVED, so every call to it comes AFTER the write.
 */
import { HttpException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  selectsFor,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { FollowsController, hubFollowSchema } from './follows.controller';
import { FollowsService } from './follows.service';

const PAUL = '11111111-1111-4111-8111-111111111111';
const MARC = 'u-marc';
const hubFollow = (follower: string, profile: string, on?: boolean) => ({
  follower_user_id: follower,
  followed_global_person_id: profile,
  created_at: '2026-10-01T00:00:00Z',
  ...(on === undefined ? {} : { notify_referee_start: on }),
});
const HIS = [
  { method: 'eq', args: ['follower_user_id', MARC] },
  { method: 'eq', args: ['followed_global_person_id', PAUL] },
];

/** Marc and Nina follow Paul from the hub; Marc follows Léa too. Paul is on the Open's roster. */
function tables(): Record<string, TableSeed> {
  return {
    directory_follows: {
      rows: [
        hubFollow(MARC, PAUL, false),
        hubFollow('u-nina', PAUL, true),
        hubFollow(MARC, 'gp-lea'),
      ],
    },
    persons: {
      rows: [
        {
          id: 'paul-open',
          global_person_id: PAUL,
          event_id: 'open',
          events: { status: 'published', event_kind: 'standard' },
        },
      ],
    },
    follows: { rows: [] },
  };
}

function build(overrides: Record<string, TableSeed> = {}) {
  const db = mockSupabase({ ...tables(), ...overrides });
  // What had been written when each alert step ran: the alerts come after the write.
  const steps: Array<[string, Array<[string, string]>]> = [];
  const written = () => db.writes.map((write): [string, string] => [write.table, write.op]);
  const scheduler = {
    applyFollow: vi.fn(async () => void steps.push(['applyFollow', written()])),
    applyHubFollow: vi.fn(async (_profile: string, _followers: readonly string[]) => {
      steps.push(['applyHubFollow', written()]);
    }),
  };
  const service = new FollowsService(db as never, {} as never, scheduler as never, {} as never);
  return { db, service, scheduler, steps };
}

describe('the hub switch is saved on his own hub follow, then acts at once', () => {
  it.each([[true], [false]])(
    'saves %s on his follow of that person, and nobody else’s',
    async (on) => {
      const { db, service } = build();

      await expect(service.setHubRefereeAlert(PAUL, MARC, on)).resolves.toEqual({
        globalPersonId: PAUL,
        notifyRefereeStart: on,
      });

      expect(db.writes).toHaveLength(1);
      expect(writesTo(db, 'directory_follows')).toMatchObject([
        { op: 'update', row: { notify_referee_start: on }, filters: HIS },
      ]);
      // PostgREST hands back no row unless asked: "no row" is how a missing follow is told.
      expect(selectsFor(db.from, 'directory_follows')).toEqual(['followed_global_person_id']);
    },
  );

  it('asks for his alerts about that person’s duties once the switch is saved', async () => {
    const { service, scheduler, steps } = build();

    await service.setHubRefereeAlert(PAUL, MARC, true);

    expect(scheduler.applyHubFollow.mock.calls).toEqual([[PAUL, [MARC]]]);
    expect(steps).toEqual([['applyHubFollow', [['directory_follows', 'update']]]]);
  });

  it.each<[string, string, string]>([
    ['a person he does not follow from the hub', 'gp-tom', MARC],
    ['an account that follows nobody', PAUL, 'u-nobody'],
  ])('answers "Follow not found" for %s, and asks for no alert', async (_, profile, user) => {
    const { service, scheduler } = build();

    const failure = await service.setHubRefereeAlert(profile, user, true).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(NotFoundException);
    expect((failure as Error).message).toBe('Follow not found');
    expect(scheduler.applyHubFollow).not.toHaveBeenCalled();
  });

  it('a failed write is a plain error, a 5xx, never "not found"', async () => {
    const { service, scheduler } = build({
      directory_follows: { data: null, error: { message: 'boom' } },
    });

    const save = service.setHubRefereeAlert(PAUL, MARC, true);

    await expect(save).rejects.toThrow('directory follow write failed: boom');
    await expect(save).rejects.not.toBeInstanceOf(HttpException);
    expect(scheduler.applyHubFollow).not.toHaveBeenCalled();
  });

  it('alerts that cannot be set fail the call, with the switch saved; the same call again sets them', async () => {
    const { db, service, scheduler } = build();
    scheduler.applyHubFollow.mockRejectedValueOnce(
      new Error('Duties of a followed referee unreadable: boom'),
    );

    await expect(service.setHubRefereeAlert(PAUL, MARC, true)).rejects.toThrow('unreadable: boom');
    expect(writesTo(db, 'directory_follows')).toHaveLength(1);

    await service.setHubRefereeAlert(PAUL, MARC, true);
    expect(scheduler.applyHubFollow).toHaveBeenCalledTimes(2);
  });
});

describe('the hub unfollow turns the hub switch off FIRST', () => {
  it('mutes, unfollows each Event, removes the duty alerts, then deletes the hub follow', async () => {
    const { db, service, scheduler, steps } = build();

    await service.unfollowAllEvents(PAUL, { userId: MARC });

    const [mute, remove] = writesTo(db, 'directory_follows');
    expect(mute).toMatchObject({
      op: 'update',
      row: { notify_referee_start: false },
      filters: HIS,
    });
    expect(remove).toMatchObject({ op: 'delete', filters: HIS });
    // An Event unfollow sets his alerts again from the SAVED rows: with the hub switch still on,
    // it would set the duty alert back. And the hub follow goes last, for the second tap.
    expect(steps).toEqual([
      [
        'applyFollow',
        [
          ['directory_follows', 'update'],
          ['follows', 'delete'],
        ],
      ],
      [
        'applyHubFollow',
        [
          ['directory_follows', 'update'],
          ['follows', 'delete'],
        ],
      ],
    ]);
    expect(scheduler.applyHubFollow.mock.calls).toEqual([[PAUL, [MARC]]]);
    expect(db.writes.at(-1)).toMatchObject({ table: 'directory_follows', op: 'delete' });
  });

  it('keeps the hub follow when the duty alerts cannot be removed, for the second tap', async () => {
    const { db, service, scheduler } = build();
    scheduler.applyHubFollow.mockRejectedValueOnce(
      new Error('Duties of a followed referee unreadable: boom'),
    );
    const ops = () => writesTo(db, 'directory_follows').map((write) => write.op);

    await expect(service.unfollowAllEvents(PAUL, { userId: MARC })).rejects.toThrow(
      'unreadable: boom',
    );
    expect(ops()).toEqual(['update']);

    await service.unfollowAllEvents(PAUL, { userId: MARC });
    expect(ops()).toEqual(['update', 'update', 'delete']);
  });

  it('a guest session has no hub follow: nothing of it is written or asked', async () => {
    const { db, service, scheduler } = build();

    await service.unfollowAllEvents(PAUL, { guestSessionId: 'guest-1', guestEventId: 'open' });

    expect(writesTo(db, 'directory_follows')).toEqual([]);
    expect(scheduler.applyHubFollow).not.toHaveBeenCalled();
  });
});

describe('the "Following" tab is handed the hub switch as saved', () => {
  it('reads the switch, and takes only an exact "true" as on', async () => {
    const { db, service } = build();

    const mine = await service.listDirectoryFollows(MARC);
    const hers = await service.listDirectoryFollows('u-nina');

    expect(selectsFor(db.from, 'directory_follows')[0]).toBe(
      'followed_global_person_id, created_at, notify_referee_start',
    );
    expect(mine.map((follow) => [follow.globalPersonId, follow.notifyRefereeStart])).toEqual([
      [PAUL, false],
      // A row with no value: not "on".
      ['gp-lea', false],
    ]);
    expect(hers.map((follow) => follow.notifyRefereeStart)).toEqual([true]);
  });
});

describe('PATCH me/follows/by-global-person/:globalPersonId', () => {
  const follows = { setHubRefereeAlert: vi.fn() };
  const guestJwt = { verify: vi.fn(() => ({ sub: 'g1', event_id: 'open' })) };
  const supabase = { getAuthUser: vi.fn(async (token: string) => ({ id: token })) };
  const controller = new FollowsController(
    follows as never,
    { list: vi.fn() } as never,
    guestJwt as never,
    supabase as never,
  );
  const as = (cookies: Record<string, string>) => ({ cookies }) as unknown as FastifyRequest;

  beforeEach(() => {
    follows.setHubRefereeAlert.mockReset();
  });

  it('saves the switch for the signed-in account', async () => {
    follows.setHubRefereeAlert.mockResolvedValue({
      globalPersonId: PAUL,
      notifyRefereeStart: true,
    });

    await expect(
      controller.updateHubFollow(
        PAUL,
        { notifyRefereeStart: true },
        as({ 'sb-access-token': MARC }),
      ),
    ).resolves.toEqual({ globalPersonId: PAUL, notifyRefereeStart: true });

    expect(follows.setHubRefereeAlert.mock.calls).toEqual([[PAUL, MARC, true]]);
  });

  it.each<[string, Record<string, string>]>([
    ['an anonymous caller', {}],
    ['a guest session: it has no hub follow', { mc_guest: 'guest-token' }],
  ])('refuses %s with a 401 in its own words, and saves nothing', async (_, cookies) => {
    const failure = await controller
      .updateHubFollow(PAUL, { notifyRefereeStart: true }, as(cookies))
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(UnauthorizedException);
    expect((failure as Error).message).toBe('Sign in to set this alert');
    expect(follows.setHubRefereeAlert).not.toHaveBeenCalled();
  });

  it('the organisation follows keep their own words', async () => {
    await expect(controller.listFollowedOrganizations(as({}))).rejects.toThrow(
      /^Sign in to follow an organisation$/,
    );
  });

  it.each<[string, unknown, boolean]>([
    ['the switch on', { notifyRefereeStart: true }, true],
    ['the switch off', { notifyRefereeStart: false }, true],
    ['no switch', {}, false],
    ['a switch that is no boolean', { notifyRefereeStart: 'true' }, false],
    ['another key', { notifyRefereeStart: true, notifyMatchStart: true }, false],
  ])('takes a body with %s: %s', (_, body, ok) => {
    expect(hubFollowSchema.safeParse(body).success).toBe(ok);
  });
});
