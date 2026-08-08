import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { StaffService, STAFF_COOKIE_NAME } from './staff.service';
import { mockSupabase } from '../../common/testing/supabase-chain';

/**
 * `event_staff_accounts.role` is an authorization boundary, not a label.
 *
 * Migration 0168 deleted the previous `role` column precisely because it was a
 * label: the organizer could pick one and no code path ever read it. 0173
 * re-adds it under the opposite contract, so these tests assert the contract
 * rather than the storage — a green suite here means a check-in volunteer
 * genuinely cannot score a bout, not that the UI declines to link them there.
 *
 * Two properties matter, and they are tested separately:
 *
 *   1. The refusal happens. A `checkin` or `gear` account is rejected from
 *      every scoring surface.
 *   2. The refusal reads the ROW, not the token. The mc_staff JWT carries only
 *      { sub, event_id, type }, so a role change must land on the next request.
 *      Test 3 proves it by changing the stored row under a fixed token.
 */

/** The event every fixture belongs to. `running` so `assertEventScorable` passes. */
const EVENT = {
  id: 'event-1',
  organization_id: 'org-1',
  slug: 'fal-2026',
  name: 'FAL 2026',
  status: 'running',
  start_date: '2026-08-08',
  end_date: '2099-12-31',
};

function accountRow(role: string) {
  return {
    id: 'staff-1',
    event_id: EVENT.id,
    display_name: 'Marie Dubois',
    username: 'marie',
    pin_hash: 'x',
    status: 'active',
    role,
  };
}

/** A request carrying a staff cookie. The value is irrelevant — the jwt is stubbed. */
function staffRequest(): FastifyRequest {
  return { cookies: { [STAFF_COOKIE_NAME]: 'token' }, headers: {} } as unknown as FastifyRequest;
}

/**
 * A service wired to answer exactly the two tables the gate touches.
 *
 * `event_staff_accounts` takes a QUEUE so a test can hand back a different row
 * on the second read — that is how "the role is re-read per request" is proven
 * without inventing a second token.
 */
function makeService(accountRows: Array<Record<string, unknown>>) {
  const supabase = mockSupabase({
    event_staff_accounts: accountRows.map((data) => ({ data, error: null })),
    events: { data: EVENT, error: null },
    // No assignments. The allow-path assertions are about the gate letting the
    // request through, and an empty list is what the route legitimately returns
    // for an account nobody has put on a piste yet — resolving to `[]` proves
    // the gate passed without dragging the whole per-lice current-match fetch
    // into a role test.
    event_staff_lice_assignments: { data: [], error: null },
  });
  const jwt = {
    // Deliberately role-free: this IS the token's real payload shape. If a
    // future change starts reading a role off the token, these tests keep
    // passing only because the row still says the same thing — so test 3,
    // which desyncs the two, is the one that catches it.
    verify: () => ({ sub: 'staff-1', event_id: EVENT.id, type: 'staff' }),
  };
  return new StaffService(
    supabase as never,
    {} as never,
    jwt as never,
    {} as never,
  ) as StaffService & {
    listAssignedLices: (req: FastifyRequest) => Promise<unknown>;
  };
}

describe('StaffService role gate', () => {
  it('refuses a check-in account on a scoring surface', async () => {
    const service = makeService([accountRow('checkin')]);

    await expect(service.listAssignedLices(staffRequest())).rejects.toThrow(
      /role cannot use this surface/i,
    );
  });

  it('refuses a gear account on a scoring surface', async () => {
    const service = makeService([accountRow('gear')]);

    await expect(service.listAssignedLices(staffRequest())).rejects.toThrow(
      /role cannot use this surface/i,
    );
  });

  it('re-reads the role from the row, so a mid-session change takes effect immediately', async () => {
    // Same token throughout. The organiser moves this volunteer from the
    // Check-in tab to Scoring between the two calls; nothing about the session
    // changes. If the role were carried in the JWT the first refusal would
    // persist until the volunteer signed in again — on an event day, that is
    // the organiser's fix appearing to do nothing.
    const service = makeService([accountRow('checkin'), accountRow('scoring')]);
    const req = staffRequest();

    await expect(service.listAssignedLices(req)).rejects.toThrow(/role cannot use this surface/i);
    await expect(service.listAssignedLices(req)).resolves.toBeDefined();
  });

  it('allows a scoring account, the historical default', async () => {
    const service = makeService([accountRow('scoring')]);

    await expect(service.listAssignedLices(staffRequest())).resolves.toBeDefined();
  });

  it('treats an unrecognised stored role as scoring rather than locking the account out', async () => {
    // parseStaffRole falls back to 'scoring' on purpose: a row written before
    // the CHECK constraint, or by hand, must degrade to what a bare staff
    // account has always been. The alternative — refusing everything — would
    // strand a piste mid-event over a data defect.
    const service = makeService([accountRow('arbitre_table')]);

    await expect(service.listAssignedLices(staffRequest())).resolves.toBeDefined();
  });
});
