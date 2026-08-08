import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { CheckinService } from './checkin.service';
import { mockSupabase, supabaseChain } from '../../common/testing/supabase-chain';

/**
 * The desk's authorization contract.
 *
 * The plan's security-relevant claim is that a `scoring` account cannot work
 * the desk and a `checkin` account cannot score. The second half lives in
 * staff.service.role.test.ts; this is the first half — and, more importantly,
 * proof that the desk asks for the role AT ALL. A route that simply forgot to
 * call `requireStaffWithRole` would still pass every happy-path test.
 */

const REQ = {} as FastifyRequest;

/**
 * A PassService double. Most tests never touch the QR lane, so the default
 * refuses every token — a test that reached it by accident would fail loudly
 * rather than resolve a person out of nowhere.
 */
function passDouble(personId?: string) {
  return {
    resolve: vi.fn(() => {
      if (!personId) return Promise.reject(new Error('pass_not_recognized'));
      return Promise.resolve({ personId });
    }),
  };
}

/** A StaffService double that records the roles it was asked to enforce. */
function staffDouble(role: 'checkin' | 'scoring' | 'gear' = 'checkin') {
  const asked: string[][] = [];
  return {
    asked,
    service: {
      requireStaffWithRole: vi.fn((_req: FastifyRequest, roles: readonly string[]) => {
        asked.push([...roles]);
        if (!roles.includes(role)) {
          throw new Error('Staff account role cannot use this surface');
        }
        return Promise.resolve({ id: 'staff-1', event_id: 'event-1', role });
      }),
    },
  };
}

describe('CheckinService authorization', () => {
  it('gates every desk read on the checkin role', async () => {
    const staff = staffDouble('checkin');
    const supabase = mockSupabase({
      persons: { data: [], error: null },
      event_arrivals: { data: [], error: null },
    });
    const service = new CheckinService(
      supabase as never,
      staff.service as never,
      passDouble() as never,
    );

    await service.searchRoster(REQ, 'mar');

    expect(staff.service.requireStaffWithRole).toHaveBeenCalled();
    expect(staff.asked[0]).toEqual(['checkin']);
  });

  it('refuses a scoring account at the desk', async () => {
    const staff = staffDouble('scoring');
    const supabase = mockSupabase({ persons: { data: [], error: null } });
    const service = new CheckinService(
      supabase as never,
      staff.service as never,
      passDouble() as never,
    );

    await expect(service.searchRoster(REQ, 'mar')).rejects.toThrow(/cannot use this surface/i);
  });

  it('refuses a gear account at the desk', async () => {
    const staff = staffDouble('gear');
    const supabase = mockSupabase({ persons: { data: [], error: null } });
    const service = new CheckinService(
      supabase as never,
      staff.service as never,
      passDouble() as never,
    );

    await expect(service.searchRoster(REQ, 'mar')).rejects.toThrow(/cannot use this surface/i);
  });
});

describe('CheckinService.markArrived', () => {
  it('upserts on (event_id, person_id) so a double tap cannot make two rows', async () => {
    const staff = staffDouble('checkin');
    const arrivals = supabaseChain({ data: { person_id: 'p1', state: 'present' }, error: null });
    const supabase = mockSupabase({ persons: { data: { id: 'p1' }, error: null } });
    supabase.from.mockImplementation((table: string) =>
      table === 'event_arrivals' ? arrivals : supabaseChain({ data: { id: 'p1' }, error: null }),
    );
    const service = new CheckinService(
      supabase as never,
      staff.service as never,
      passDouble() as never,
    );

    await service.markArrived(REQ, 'p1', { via: 'qr' } as never);

    // Two volunteers tapping the same name at the same moment must converge on
    // one row. Without the conflict target this is an INSERT that races.
    expect(arrivals.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ person_id: 'p1', state: 'present', via: 'qr' }),
      { onConflict: 'event_id,person_id' },
    );
  });

  it('refuses a person who is not on this event roster', async () => {
    // A stale tab or a scanned pass from another event. Refusing here is what
    // keeps a desk account's reach equal to its own event.
    const staff = staffDouble('checkin');
    const supabase = mockSupabase({ persons: { data: null, error: null } });
    const service = new CheckinService(
      supabase as never,
      staff.service as never,
      passDouble() as never,
    );

    await expect(service.markArrived(REQ, 'stranger', { via: 'search' } as never)).rejects.toThrow(
      /not on this event roster/i,
    );
  });
});

describe('CheckinService.undoArrival', () => {
  it('updates state to absent with a reversal actor, and never deletes', async () => {
    const staff = staffDouble('checkin');
    const arrivals = supabaseChain({ data: { person_id: 'p1', state: 'absent' }, error: null });
    const supabase = mockSupabase({ event_arrivals: { data: null, error: null } });
    supabase.from.mockReturnValue(arrivals);
    const service = new CheckinService(
      supabase as never,
      staff.service as never,
      passDouble() as never,
    );

    await service.undoArrival(REQ, 'p1');

    // Deleting would erase that a mis-tap happened at all, and "who marked
    // Marie present and then unmarked her" is exactly the question asked when
    // a fighter insists they checked in.
    expect(arrivals.delete).not.toHaveBeenCalled();
    expect(arrivals.update).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'absent', reversed_by_staff_account_id: 'staff-1' }),
    );
  });

  it('treats undoing a never-marked person as already absent, not as an error', async () => {
    // A double-tap on Undo must not read as a failure to the volunteer.
    const staff = staffDouble('checkin');
    const supabase = mockSupabase({ event_arrivals: { data: null, error: null } });
    const service = new CheckinService(
      supabase as never,
      staff.service as never,
      passDouble() as never,
    );

    await expect(service.undoArrival(REQ, 'never-marked')).resolves.toEqual(
      expect.objectContaining({ state: 'absent' }),
    );
  });
});

describe('CheckinService.redeemPass — the QR fast lane', () => {
  const PERSON = {
    id: 'p1',
    given_name: 'Marie',
    family_name: 'Dubois',
    club_id: 'c1',
    global_person_id: 'g1',
    clubs: { name: 'Club de Lyon', logo_url: null },
    global_persons: { photo_url: 'https://example.test/marie.jpg' },
  };

  it('gates on the checkin role like every other desk route', async () => {
    const staff = staffDouble('checkin');
    const supabase = mockSupabase({
      event_arrivals: { data: { person_id: 'p1', state: 'present', via: 'qr' }, error: null },
      persons: { data: [PERSON], error: null },
    });
    const service = new CheckinService(
      supabase as never,
      staff.service as never,
      passDouble('p1') as never,
    );

    await service.redeemPass(REQ, 'a'.repeat(43));

    expect(staff.asked[0]).toEqual(['checkin']);
  });

  it('refuses a scoring account — the UI not linking there is not a gate', async () => {
    const staff = staffDouble('scoring');
    const supabase = mockSupabase({});
    const service = new CheckinService(
      supabase as never,
      staff.service as never,
      passDouble('p1') as never,
    );

    await expect(service.redeemPass(REQ, 'a'.repeat(43))).rejects.toThrow(
      /cannot use this surface/i,
    );
  });

  it('resolves the token INSIDE this session event, never globally', async () => {
    const staff = staffDouble('checkin');
    const pass = passDouble('p1');
    const supabase = mockSupabase({
      event_arrivals: { data: { person_id: 'p1', state: 'present', via: 'qr' }, error: null },
      persons: { data: [PERSON], error: null },
    });
    const service = new CheckinService(supabase as never, staff.service as never, pass as never);

    await service.redeemPass(REQ, 'tok');

    // Without the event argument a pass from last month's event would resolve
    // to a person this desk then fails to mark.
    expect(pass.resolve).toHaveBeenCalledWith('tok', 'event-1');
  });

  it('records via=qr, so the two capture paths stay comparable after the event', async () => {
    const staff = staffDouble('checkin');
    const arrivals = supabaseChain({
      data: { person_id: 'p1', state: 'present', via: 'qr', marked_at: '2026-08-08T09:12:00Z' },
      error: null,
    });
    const people = supabaseChain({ data: [PERSON], error: null });
    const supabase = mockSupabase({ event_arrivals: { data: null, error: null } });
    supabase.from.mockReturnValueOnce(arrivals).mockReturnValueOnce(people);
    const service = new CheckinService(
      supabase as never,
      staff.service as never,
      passDouble('p1') as never,
    );

    await service.redeemPass(REQ, 'tok');

    expect(arrivals.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ via: 'qr', state: 'present', person_id: 'p1' }),
      { onConflict: 'event_id,person_id' },
    );
  });

  it('returns the full desk row so the overlay shows the face it just admitted', async () => {
    const staff = staffDouble('checkin');
    const arrivals = supabaseChain({
      data: { person_id: 'p1', state: 'present', via: 'qr', marked_at: '2026-08-08T09:12:00Z' },
      error: null,
    });
    const people = supabaseChain({ data: [PERSON], error: null });
    const supabase = mockSupabase({ event_arrivals: { data: null, error: null } });
    supabase.from.mockReturnValueOnce(arrivals).mockReturnValueOnce(people);
    const service = new CheckinService(
      supabase as never,
      staff.service as never,
      passDouble('p1') as never,
    );

    await expect(service.redeemPass(REQ, 'tok')).resolves.toEqual({
      personId: 'p1',
      givenName: 'Marie',
      familyName: 'Dubois',
      clubName: 'Club de Lyon',
      clubLogoUrl: null,
      photoUrl: 'https://example.test/marie.jpg',
      arrived: true,
      arrivedAt: '2026-08-08T09:12:00Z',
      via: 'qr',
    });
  });

  it('propagates an unrecognised token rather than marking someone', async () => {
    const staff = staffDouble('checkin');
    const supabase = mockSupabase({});
    const service = new CheckinService(
      supabase as never,
      staff.service as never,
      passDouble() as never,
    );

    await expect(service.redeemPass(REQ, 'garbage')).rejects.toThrow(/pass_not_recognized/);
  });
});
