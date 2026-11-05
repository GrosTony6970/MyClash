import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { STAFF_ROLES, type StaffRole } from '@myclash/types';
import { beforeAll, describe, expect, it } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { pinHash, PIN } from './staff.service.login.fixtures';
import { STAFF_COOKIE_NAME, StaffService } from './staff.service';

/**
 * A staff session once its Event is over.
 *
 * The archived-Event lock cannot place the check-in, gear, photo and heartbeat
 * routes: their address names a person, a photo or nothing, and the Event comes
 * from the staff session. `archived-lock-ledger.ts` files them as locked by THIS
 * check, so this test holds that claim (ruling 222).
 *
 * Ruling 437: the `photos` job keeps working on a completed Event, until it is
 * archived. Phones send photos until the end of the day after the last day, and
 * someone has to approve them. Every other job is refused once the Event is
 * completed, as before.
 */
const EVENT = 'e0000000-0000-4000-8000-000000000001';
const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const req = { cookies: { [STAFF_COOKIE_NAME]: 'signed' } } as never;
const FROZEN = { message: 'Event is not open for staff scoring', code: 'event_results_frozen' };
let hash = '';

beforeAll(async () => {
  hash = await pinHash(PIN);
});

function service(status: string, role: StaffRole) {
  const db = mockSupabase({
    event_staff_accounts: {
      rows: [
        {
          id: ACCOUNT,
          event_id: EVENT,
          display_name: 'Léa',
          username: 'lea',
          pin_hash: hash,
          status: 'active',
          role,
        },
      ],
    },
    events: { rows: [{ id: EVENT, organization_id: 'org-1', status, end_date: '2099-12-31' }] },
    // What the sign-in's `me` reads after the door: a non-scoring job has no piste.
    event_staff_lice_assignments: { rows: [] },
    lices: { rows: [] },
  });
  const jwt = { verify: () => ({ event_id: EVENT, sub: ACCOUNT }), sign: () => 'signed' };
  return new StaffService(db as never, {} as never, jwt as never, {} as never);
}

const login = (pin = PIN, username = 'lea') => ({
  eventId: EVENT,
  eventSlugOrCode: 'open',
  username,
  pin,
});

/** Whether each job may act, per Event status: ruling 437. */
const OPEN: Record<string, (role: StaffRole) => boolean> = {
  running: () => true,
  completed: (role) => role === 'photos',
  archived: () => false,
};

const cases = Object.keys(OPEN).flatMap((status) =>
  STAFF_ROLES.map((role) => [status, role, OPEN[status]!(role)] as const),
);

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (e: unknown) => e,
  );
}

describe('StaffService: a staff session of an Event that is over', () => {
  it.each(cases)('on a %s Event, a %s session open: %s', async (status, role, open) => {
    const err = await refusal(service(status, role).requireStaffWithRole(req, [role]));
    if (open) {
      expect(err).toBeNull();
      return;
    }
    expect(err).toBeInstanceOf(ForbiddenException);
    // A 403 still (the sign-in screen words it by its status), with the code a pad says.
    expect((err as ForbiddenException).getResponse()).toEqual(FROZEN);
  });

  it.each(cases)('on a %s Event, a %s sign-in open: %s', async (status, role, open) => {
    const err = await refusal(service(status, role).login(login()));
    if (open) {
      expect(err).toBeNull();
      return;
    }
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toEqual(FROZEN);
  });

  // The door's order is unchanged for every job but `photos`: the Event is refused before the
  // username, the "disabled" state and the PIN are looked at.
  it('refuses a check-in sign-in on a completed Event before its wrong PIN', async () => {
    const err = await refusal(service('completed', 'checkin').login(login('000000')));
    expect((err as ForbiddenException).getResponse()).toEqual(FROZEN);
  });

  it('refuses an unknown username on a completed Event as the Event, not the name', async () => {
    const err = await refusal(service('completed', 'photos').login(login(PIN, 'nobody')));
    expect((err as ForbiddenException).getResponse()).toEqual(FROZEN);
  });

  it('checks the PIN of a photos sign-in on a completed Event', async () => {
    const err = await refusal(service('completed', 'photos').login(login('000000')));
    expect(err).toBeInstanceOf(UnauthorizedException);
  });

  it('answers /me for a photos session on a completed Event, and refuses it once archived', async () => {
    await expect(service('completed', 'photos').getMe(req)).resolves.toBeDefined();
    const err = await refusal(service('archived', 'photos').getMe(req));
    expect((err as ForbiddenException).getResponse()).toEqual(FROZEN);
  });

  it('refuses a scoring session the photos job on a running Event', async () => {
    const err = await refusal(service('running', 'scoring').requireStaffWithRole(req, ['photos']));
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      code: 'staff_role_not_allowed',
    });
  });
});
