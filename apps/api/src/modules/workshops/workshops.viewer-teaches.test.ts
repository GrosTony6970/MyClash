/**
 * "Do I teach this Workshop?" on the public Workshop page (operator ruling 272).
 *
 * The page greys its register button for somebody who teaches the Workshop. The
 * read asked the caller's ACCOUNT only: Paul, who teaches and picked his name as
 * a guest, got a live button, and the booking door then refused his tap. The
 * door goes by the caller's roster row at the Event (`EnrollmentService`), so
 * the read now asks the same owner who the caller is, guest or account.
 *
 * Real controller, real service, real identity owner and JWT signer, over seeded
 * tables.
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, type TableSeed } from '../../common/testing/supabase-chain';
import { GuestJwtService } from '../auth/guest-jwt.service';
import { ParticipantIdentityService } from '../auth/participant-identity.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { WorkshopsController } from './workshops.controller';
import { WorkshopsService } from './workshops.service';

const SECRET = 'the-server-guest-secret';
const EVENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const OTHER_EVENT = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const WORKSHOP = {
  id: 'w-1',
  event_id: EVENT,
  slug: 'longsword',
  title: 'Longsword',
  short_description: null,
  description_md: null,
  category: null,
  level: 'all',
  weapon: null,
  language: 'fr',
  capacity: null,
  duration_minutes: null,
  status: 'published',
  sort_order: 0,
  color: null,
  cover_image_url: null,
  venue_id: null,
  venues: null,
  workshop_sessions: [],
  workshop_instructors: [{ global_person_id: 'gp-paul', display_name: 'Paul' }],
};

const rosterRow = (id: string, profile: string | null, holder: string | null = null) => ({
  id,
  event_id: EVENT,
  global_person_id: profile,
  claimed_by_user_id: holder,
});
const PERSONS: TableSeed = {
  rows: [
    rosterRow('paul-row', 'gp-paul'),
    rosterRow('lea-row', 'gp-lea'),
    rosterRow('solo-row', null),
    // An account's roster row an organiser linked to the instructor's profile.
    rosterRow('account-row', 'gp-paul', 'u-linked'),
  ],
};

function build(persons: TableSeed = PERSONS) {
  const db = mockSupabase({
    events: {
      rows: [
        {
          id: EVENT,
          slug: 'open',
          timezone: 'Europe/Paris',
          status: 'published',
          organization_id: 'org-a',
        },
      ],
    },
    workshops: { rows: [WORKSHOP] },
    persons,
    // The account that holds the instructor's own profile.
    global_persons: { rows: [{ id: 'gp-paul', claimed_by_user_id: 'u-paul' }] },
    guest_sessions: { rows: [{ id: 'gs-1', revoked_at: null, persons: PERSON_FREE }] },
    organization_members: { rows: [] },
    event_staff_accounts: { rows: [] },
  });
  // The login cookie's own value names the account: `tok-<user id>`.
  const getAuthUser = async (token: string) => ({ id: token.replace('tok-', '') });
  const supabase = { service: db.service, from: db.from, getAuthUser };
  const orgs = new OrganizationsService(supabase as never);
  const privacy = { hiddenWorkshopGlobalPersonIds: async () => new Set<string>() };
  const service = new WorkshopsService(
    supabase as never,
    {} as never,
    {} as never,
    orgs,
    privacy as never,
    {} as never,
  );
  const guestJwt = new GuestJwtService({ getOrThrow: () => SECRET } as never);
  const identity = new ParticipantIdentityService(supabase as never, guestJwt);
  const controller = new WorkshopsController(
    service,
    {} as never,
    supabase as never,
    {} as never,
    {} as never,
    identity,
  );
  const teaches = async (req: never) =>
    (await controller.getPublicBySlug('longsword', 'open', req)).viewerIsInstructor;
  return { teaches, from: db.from };
}

/** No account holds the guest's roster person: only then is her session an identity. */
const PERSON_FREE = { claimed_by_user_id: null };

const anonymous = { headers: {}, cookies: {}, identity: { kind: 'anonymous' } } as never;
const guest = (personId: string, eventId = EVENT) =>
  ({
    headers: {},
    identity: { kind: 'anonymous' },
    cookies: {
      mc_guest: jwt.sign(
        { sub: 'gs-1', person_id: personId, event_id: eventId, type: 'guest' },
        SECRET,
        { expiresIn: 3600 },
      ),
    },
  }) as never;
/** A signed-in account, as the AuthGuard leaves the request. */
const account = (userId: string) =>
  ({
    headers: {},
    identity: { kind: 'claimed', userId, email: null },
    cookies: { 'sb-access-token': `tok-${userId}` },
  }) as never;

afterEach(() => vi.restoreAllMocks());

describe('the public Workshop read tells the caller whether she teaches it (ruling 272)', () => {
  it('says yes to a guest whose roster row is the instructor’s', async () => {
    const { teaches, from } = build();

    await expect(teaches(guest('paul-row'))).resolves.toBe(true);
    // The double ignores the projection: only this holds the column the answer reads.
    expect(selectsFor(from, 'persons')).toEqual(['global_person_id']);
  });

  it.each([
    ['a guest who does not teach it', guest('lea-row')],
    ['a guest whose roster row has no profile', guest('solo-row')],
    ['a guest session of another Event', guest('paul-row', OTHER_EVENT)],
    ['nobody', anonymous],
    ['an account that teaches nothing and has no roster row', account('u-stranger')],
  ])('says no to %s', async (_who, req) => {
    await expect(build().teaches(req)).resolves.toBe(false);
  });

  it('still says yes to the account that holds the instructor’s profile', async () => {
    await expect(build().teaches(account('u-paul'))).resolves.toBe(true);
  });

  it('says yes to an account whose roster row is the instructor’s, as the booking door does', async () => {
    await expect(build().teaches(account('u-linked'))).resolves.toBe(true);
  });

  it('reads no roster row for nobody', async () => {
    const { teaches, from } = build();

    await teaches(anonymous);

    expect(selectsFor(from, 'persons')).toEqual([]);
  });

  it('keeps the public page up when the roster row cannot be read: a live button, and a trace', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { teaches } = build({ data: null, error: { message: 'connection reset' } });

    // The hint is lost, not the page: the booking door still refuses a teacher's tap.
    await expect(teaches(guest('paul-row'))).resolves.toBe(false);
    expect(warn.mock.calls.map(([line]) => String(line))).toEqual([
      "Workshop w-1: the caller's roster row could not be read, the register button stays live: Roster row paul-row unreadable: connection reset",
    ]);
  });

  it('leaves no trace when nothing failed', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await build().teaches(guest('lea-row'));

    expect(warn).not.toHaveBeenCalled();
  });
});
