import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { StaffService, STAFF_COOKIE_NAME } from './staff.service';
import { mockSupabase, queriedTables } from '../../common/testing/supabase-chain';

/**
 * The two staff routes that read a whole tournament: the pool list and the
 * bracket behind a piste screen.
 *
 * They exist rather than pointing the tablet at
 * `/tournaments/:id/pools-with-matches` for one reason, which the source states
 * plainly: that route takes only an id and asserts nothing about which event
 * the caller belongs to, so any identity can read any tournament. These two pin
 * the tournament to the staff session's own event first.
 *
 * Nothing tested that. `requireTournamentInStaffEvent` — the method holding the
 * pin — was executed by NO test in the API suite, so the whole check could have
 * been deleted with the suite still green. A PIN issued for one event would
 * then read a neighbouring event's draw: who is fighting whom, and when.
 *
 * The order matters as much as the check. The piste gate runs BEFORE the
 * tournament is loaded, so an account with no business on this piste never
 * learns whether the tournament exists; `queriedTables` is how that is proved.
 */

const EVENT = 'event-1';
const OTHER_EVENT = 'event-2';
const ACCOUNT = 'staff-1';
const LICE = 'lice-1';
const TOURNAMENT = 'tournament-1';
const OTHER_TOURNAMENT = 'tournament-2';

const EVENT_ROW = {
  id: EVENT,
  organization_id: 'org-1',
  slug: 'fal-2026',
  name: 'FAL 2026',
  status: 'running',
  start_date: '2026-08-08',
  end_date: '2099-12-31',
};

const accountRow = (role = 'scoring', status = 'active') => ({
  id: ACCOUNT,
  event_id: EVENT,
  display_name: 'Marie Dubois',
  username: 'marie',
  pin_hash: 'x',
  status,
  role,
});

/**
 * The neighbouring event's tournament, seeded FIRST. These reads end in
 * `maybeSingle`, which takes the first surviving row, so this is what a lost
 * `.eq('id', …)` hands back — and it is the row the pin exists to refuse.
 */
const TOURNAMENT_ROWS = [
  { id: OTHER_TOURNAMENT, event_id: OTHER_EVENT },
  { id: TOURNAMENT, event_id: EVENT },
];

const staffRequest = () =>
  ({ cookies: { [STAFF_COOKIE_NAME]: 'token' }, headers: {} }) as unknown as FastifyRequest;

function build(
  opts: { role?: string; assigned?: boolean; tournaments?: typeof TOURNAMENT_ROWS } = {},
) {
  const supabase = mockSupabase({
    event_staff_accounts: { rows: [accountRow(opts.role)] },
    events: { rows: [EVENT_ROW] },
    event_staff_lice_assignments: {
      rows:
        opts.assigned === false
          ? []
          : [{ id: 'assignment-1', staff_account_id: ACCOUNT, lice_id: LICE }],
    },
    tournaments: { rows: opts.tournaments ?? TOURNAMENT_ROWS },
  });
  const phases = {
    listPoolsWithMatches: vi.fn().mockResolvedValue({ pools: [] }),
    getTournamentBracket: vi.fn().mockResolvedValue({ rounds: [] }),
  };
  const jwt = { verify: () => ({ sub: ACCOUNT, event_id: EVENT, type: 'staff' }) };
  const svc = new StaffService(supabase as never, {} as never, jwt as never, phases as never);
  return { svc, phases, from: supabase.from };
}

describe('getAssignedLiceTournamentPools', () => {
  it('reads the pools of a tournament in the session’s own event', async () => {
    const { svc, phases } = build();

    await expect(
      svc.getAssignedLiceTournamentPools(staffRequest(), LICE, TOURNAMENT),
    ).resolves.toEqual({ pools: [] });
    expect(phases.listPoolsWithMatches).toHaveBeenCalledWith(TOURNAMENT);
  });

  it('refuses a tournament belonging to another event', async () => {
    // The whole reason these routes exist. A tablet signed in to FAL 2026 asks
    // for a tournament that is not FAL 2026's, and must be told no rather than
    // handed the draw.
    const { svc, phases } = build();

    await expect(
      svc.getAssignedLiceTournamentPools(staffRequest(), LICE, OTHER_TOURNAMENT),
    ).rejects.toThrow(/Tournament belongs to another event/i);
    expect(phases.listPoolsWithMatches).not.toHaveBeenCalled();
  });

  it('404s a tournament that does not exist', async () => {
    const { svc } = build({ tournaments: [] });

    await expect(
      svc.getAssignedLiceTournamentPools(staffRequest(), LICE, TOURNAMENT),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a piste this account is not on, BEFORE loading the tournament', async () => {
    // Ordering is the assertion. Reading the tournament first would tell an
    // account with no claim on this piste whether it exists at all.
    const { svc, from } = build({ assigned: false });

    await expect(
      svc.getAssignedLiceTournamentPools(staffRequest(), LICE, TOURNAMENT),
    ).rejects.toThrow(/not assigned to this Lice/i);
    expect(queriedTables(from), 'the piste gate must precede the tournament read').not.toContain(
      'tournaments',
    );
  });

  it('refuses a desk account, which has no scoring surface at all', async () => {
    const { svc } = build({ role: 'checkin' });

    await expect(
      svc.getAssignedLiceTournamentPools(staffRequest(), LICE, TOURNAMENT),
    ).rejects.toThrow(/role cannot use this surface/i);
  });
});

describe('getAssignedLiceTournamentBracket', () => {
  // The bracket route pins the tournament through the same helper. Asserted
  // separately because the two are wired independently: a route added later
  // that forgets the call is exactly the regression this guards.
  it('reads the bracket of a tournament in the session’s own event', async () => {
    const { svc, phases } = build();

    await expect(
      svc.getAssignedLiceTournamentBracket(staffRequest(), LICE, TOURNAMENT),
    ).resolves.toEqual({ rounds: [] });
    expect(phases.getTournamentBracket).toHaveBeenCalledWith(TOURNAMENT);
  });

  it('refuses a tournament belonging to another event', async () => {
    const { svc, phases } = build();

    await expect(
      svc.getAssignedLiceTournamentBracket(staffRequest(), LICE, OTHER_TOURNAMENT),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(phases.getTournamentBracket).not.toHaveBeenCalled();
  });
});
