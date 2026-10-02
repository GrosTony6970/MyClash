import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { STAFF_COOKIE_NAME, StaffService } from './staff.service';

/**
 * A staff session is refused once its Event is over.
 *
 * The archived-Event lock cannot place the check-in, gear and heartbeat
 * routes: their address names a person or nothing, and the Event comes from
 * the staff session. `archived-lock-ledger.ts` files them as locked by THIS
 * check, so this test holds that claim (ruling 222).
 */
const EVENT = 'e0000000-0000-4000-8000-000000000001';
const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const req = { cookies: { [STAFF_COOKIE_NAME]: 'signed' } } as never;

function service(status: string) {
  const db = mockSupabase({
    event_staff_accounts: {
      rows: [{ id: ACCOUNT, event_id: EVENT, status: 'active', role: 'checkin' }],
    },
    events: { rows: [{ id: EVENT, organization_id: 'org-1', status }] },
  });
  const jwt = { verify: () => ({ event_id: EVENT, sub: ACCOUNT }) };
  return new StaffService(db as never, {} as never, jwt as never, {} as never);
}

describe('StaffService: a staff session of an Event that is over', () => {
  it.each<string>(['completed', 'archived'])('is refused when the Event is %s', async (status) => {
    await expect(service(status).requireStaffWithRole(req, ['checkin'])).rejects.toEqual(
      new ForbiddenException('Event is not open for staff scoring'),
    );
  });

  it.each<string>(['completed', 'archived'])(
    'cannot sign in when the Event is %s',
    async (status) => {
      const login = { eventId: EVENT, eventSlugOrCode: 'open', username: 'desk1', pin: '123456' };
      await expect(service(status).login(login)).rejects.toEqual(
        new ForbiddenException('Event is not open for staff scoring'),
      );
    },
  );

  it('is accepted while the Event runs', async () => {
    await expect(service('running').requireStaffWithRole(req, ['checkin'])).resolves.toEqual({
      id: ACCOUNT,
      event_id: EVENT,
      role: 'checkin',
    });
  });
});
