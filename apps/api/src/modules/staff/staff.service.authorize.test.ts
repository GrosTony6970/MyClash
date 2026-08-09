import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { StaffService, STAFF_COOKIE_NAME } from './staff.service';
import { mockSupabase, queriedTables } from '../../common/testing/supabase-chain';

/**
 * The `authorize*` family — the single choke point for every write to a bout.
 *
 * Exchanges, penalties, the clock, the match itself, forfeits: they all resolve
 * their actor through one of these six methods. Until this file they had NO
 * unit tests. Their only coverage anywhere was `tests/e2e/18-staff-pad.spec.ts`,
 * an opt-in browser spec that runs in the nightly — and which was broken from
 * 2026-08-08, so in practice the security core was unpinned entirely.
 *
 * What is asserted here is the DECISION, not its downstream effect. Whether a
 * locked match actually refuses a write belongs to `matches.service`; whether
 * the 60 s auto-lock scan runs at all is E2E-only (spec 18 owns it). These
 * methods only compute `{ userId | staffAccountId, canOverrideLocked }`, and
 * that computation is what a role or lock regression would silently change.
 *
 * Three properties are worth stating up front because they drive most cases:
 *
 *   1. **Two branches, chosen by identity.** A Supabase user takes the organizer
 *      branch; otherwise the mc_staff cookie takes the staff branch. They have
 *      different failure STATUSES (401 vs 403) and spec 18 depends on which.
 *   2. **The role gate fires first.** `authorizeMatchScoring` refuses a desk or
 *      gear account before it ever loads the match — the source comment claims
 *      that ordering, and `queriedTables` is how it gets proved.
 *   3. **Auto-lock defaults to ON.** `normalizeTournamentLockConfig` treats any
 *      non-boolean as `true`, so an unconfigured tournament must take the
 *      organizer branch in `authorizeMatchUnlock`. That default is the whole
 *      safety property: most tournaments never configure locking.
 */

const ORG = 'org-1';
const EVENT = 'event-1';
const MATCH = 'match-1';
const LICE = 'lice-1';

/** `running` so `assertEventScorable` passes on the staff branch. */
const EVENT_ROW = {
  id: EVENT,
  organization_id: ORG,
  slug: 'fal-2026',
  name: 'FAL 2026',
  status: 'running',
  start_date: '2026-08-08',
  end_date: '2099-12-31',
};

/**
 * The nested shape `getMatchContext` unwraps. PostgREST returns embedded
 * to-one rows as an object OR a single-element array depending on the relation,
 * and the service handles both — `nest: 'array'` exercises the branch nothing
 * else covers.
 */
function matchRow(
  opts: {
    liceId?: string | null;
    eventId?: string;
    lockConfigJson?: unknown;
    eventStatus?: string;
    nest?: 'object' | 'array';
  } = {},
) {
  const tournament = {
    id: 'tournament-1',
    event_id: opts.eventId ?? EVENT,
    lock_config_json: opts.lockConfigJson ?? null,
    events: { organization_id: ORG, status: opts.eventStatus ?? 'running' },
  };
  const phases =
    opts.nest === 'array' ? [{ tournaments: [tournament] }] : { tournaments: tournament };
  return { id: MATCH, lice_id: opts.liceId === undefined ? LICE : opts.liceId, phases };
}

function accountRow(role: string, status = 'active') {
  return {
    id: 'staff-1',
    event_id: EVENT,
    display_name: 'Marie Dubois',
    username: 'marie',
    pin_hash: 'x',
    status,
    role,
  };
}

const staffRequest = () =>
  ({ cookies: { [STAFF_COOKIE_NAME]: 'token' }, headers: {} }) as unknown as FastifyRequest;
const bareRequest = () => ({ cookies: {}, headers: {} }) as unknown as FastifyRequest;

interface BuildOpts {
  /** Present = organizer branch; absent = staff branch. */
  userId?: string | null;
  /** Throws for the roles listed, resolves otherwise. */
  denyRoles?: readonly string[];
  match?: Record<string, unknown> | null;
  account?: Record<string, unknown>;
  assigned?: boolean;
  exchange?: { data: unknown; error: { message: string } | null };
  penalty?: { data: unknown; error: { message: string } | null };
  forfeit?: { data: unknown; error: { message: string } | null };
}

function build(opts: BuildOpts = {}) {
  const tables: Record<string, { data: unknown; error: { message: string } | null }> = {
    matches: { data: opts.match === undefined ? matchRow() : opts.match, error: null },
    events: { data: EVENT_ROW, error: null },
    event_staff_accounts: { data: opts.account ?? accountRow('scoring'), error: null },
    event_staff_lice_assignments: {
      data: opts.assigned === false ? null : { id: 'assignment-1' },
      error: null,
    },
  };
  if (opts.exchange) tables['exchanges'] = opts.exchange;
  if (opts.penalty) tables['match_penalties'] = opts.penalty;
  if (opts.forfeit) tables['match_forfeits'] = opts.forfeit;

  const supabase = mockSupabase(tables);
  const assertOrgRole = vi.fn((_org: string, _user: string, role: string) => {
    if (opts.denyRoles?.includes(role)) return Promise.reject(new ForbiddenException('no role'));
    return Promise.resolve(undefined);
  });
  const jwt = { verify: () => ({ sub: 'staff-1', event_id: EVENT, type: 'staff' }) };

  const svc = new StaffService(
    supabase as never,
    { assertOrgRole } as never,
    jwt as never,
    {} as never,
  );
  vi.spyOn(
    svc as never as { getSupabaseUserId: () => Promise<string | null> },
    'getSupabaseUserId',
  ).mockResolvedValue(opts.userId === undefined ? null : opts.userId);

  return { svc, assertOrgRole, from: supabase.from };
}

describe('authorizeMatchScoring', () => {
  it('gives an editor the power to override a lock', async () => {
    const { svc, assertOrgRole } = build({ userId: 'user-1' });
    await expect(svc.authorizeMatchScoring(bareRequest(), MATCH)).resolves.toEqual({
      userId: 'user-1',
      canOverrideLocked: true,
    });
    expect(assertOrgRole).toHaveBeenCalledWith(ORG, 'user-1', 'scorekeeper');
  });

  it('lets a scorekeeper who is not an editor score, without the override', async () => {
    // `canOverrideLockedMatch` swallows the editor refusal on purpose. This is
    // the only test of that try/catch: if the throw ever escaped, an ordinary
    // scorekeeper's every scoring call would 403 instead of losing one power.
    const { svc } = build({ userId: 'user-1', denyRoles: ['editor'] });
    await expect(svc.authorizeMatchScoring(bareRequest(), MATCH)).resolves.toEqual({
      userId: 'user-1',
      canOverrideLocked: false,
    });
  });

  it('refuses an organizer without the scorekeeper role', async () => {
    const { svc } = build({ userId: 'user-1', denyRoles: ['scorekeeper', 'editor'] });
    await expect(svc.authorizeMatchScoring(bareRequest(), MATCH)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses a check-in account BEFORE it ever loads the match', async () => {
    // The ordering is the assertion. The source comment says a desk account is
    // refused "before the piste-assignment check it could never pass anyway";
    // nothing proved it, and a refactor that loaded the match first would leak
    // the existence of matches to an account with no business seeing them.
    const { svc, from } = build({ account: accountRow('checkin') });
    await expect(svc.authorizeMatchScoring(staffRequest(), MATCH)).rejects.toThrow(
      /role cannot use this surface/i,
    );
    expect(queriedTables(from), 'the role gate must precede getMatchContext').not.toContain(
      'matches',
    );
  });

  it('refuses a gear account the same way', async () => {
    const { svc } = build({ account: accountRow('gear') });
    await expect(svc.authorizeMatchScoring(staffRequest(), MATCH)).rejects.toThrow(
      /role cannot use this surface/i,
    );
  });

  it('refuses a tablet signed into another event', async () => {
    const { svc } = build({ match: matchRow({ eventId: 'other-event' }) });
    await expect(svc.authorizeMatchScoring(staffRequest(), MATCH)).rejects.toThrow(
      /Wrong staff event/i,
    );
  });

  it('refuses a match the organizer never put on a piste', async () => {
    const { svc } = build({ match: matchRow({ liceId: null }) });
    await expect(svc.authorizeMatchScoring(staffRequest(), MATCH)).rejects.toThrow(
      /no assigned Lice/i,
    );
  });

  it('refuses someone else’s piste', async () => {
    const { svc } = build({ assigned: false });
    await expect(svc.authorizeMatchScoring(staffRequest(), MATCH)).rejects.toThrow(
      /not assigned to this Lice/i,
    );
  });

  it('admits assigned scoring staff, and never with the override', async () => {
    const { svc } = build();
    await expect(svc.authorizeMatchScoring(staffRequest(), MATCH)).resolves.toEqual({
      staffAccountId: 'staff-1',
      canOverrideLocked: false,
    });
  });

  it('reads an embedded row that arrives as an array', async () => {
    const { svc } = build({ match: matchRow({ nest: 'array' }) });
    await expect(svc.authorizeMatchScoring(staffRequest(), MATCH)).resolves.toMatchObject({
      staffAccountId: 'staff-1',
    });
  });

  it('refuses everyone once the event is completed', async () => {
    const { svc } = build({ userId: 'user-1', match: matchRow({ eventStatus: 'completed' }) });
    await expect(svc.authorizeMatchScoring(bareRequest(), MATCH)).rejects.toThrow(
      /not open for staff scoring/i,
    );
  });

  it('answers 401, not 403, when there is no identity at all', async () => {
    const { svc } = build();
    await expect(svc.authorizeMatchScoring(bareRequest(), MATCH)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('404s a match that does not exist', async () => {
    const { svc } = build({ userId: 'user-1', match: null });
    await expect(svc.authorizeMatchScoring(bareRequest(), MATCH)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('authorizeMatchOrganizer', () => {
  it('demands EDITOR specifically', async () => {
    // Asserted on the literal string: downgrading this to `scorekeeper` would
    // hand piste staff the organizer-only powers routed through here.
    const { svc, assertOrgRole } = build({ userId: 'user-1' });
    await expect(svc.authorizeMatchOrganizer(bareRequest(), MATCH)).resolves.toEqual({
      userId: 'user-1',
      canOverrideLocked: true,
    });
    expect(assertOrgRole).toHaveBeenCalledWith(ORG, 'user-1', 'editor');
  });

  it('answers 401 for a staff cookie — there is no staff branch here', async () => {
    const { svc } = build();
    await expect(svc.authorizeMatchOrganizer(staffRequest(), MATCH)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // The status matters, not just the refusal: spec 18 asserts 401 on the
    // staff unlock attempt, and a 403 there would read as a role problem.
    await expect(svc.authorizeMatchOrganizer(staffRequest(), MATCH)).rejects.toThrow(
      /Organizer session required/i,
    );
  });

  it('refuses a non-editor organizer', async () => {
    const { svc } = build({ userId: 'user-1', denyRoles: ['editor'] });
    await expect(svc.authorizeMatchOrganizer(bareRequest(), MATCH)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('authorizeMatchUnlock', () => {
  // The fork. `normalizeTournamentLockConfig` defaults `autoLockEnabled` to
  // TRUE for anything that is not a boolean, so every unconfigured tournament
  // must land on the organizer branch. A regression to the scoring branch would
  // let piste staff reopen locked matches across most of the platform.
  it.each([
    ['null', null],
    ['an empty object', {}],
    ['the STRING "false"', { autoLockEnabled: 'false' }],
    ['a nonsense value', { autoLockEnabled: 1 }],
  ])('treats %s as auto-lock ON and demands an organizer', async (_label, lockConfigJson) => {
    const { svc } = build({ match: matchRow({ lockConfigJson }) });
    await expect(svc.authorizeMatchUnlock(staffRequest(), MATCH)).rejects.toThrow(
      /Organizer session required/i,
    );
  });

  it('with auto-lock ON, an editor may reopen', async () => {
    const { svc, assertOrgRole } = build({
      userId: 'user-1',
      match: matchRow({ lockConfigJson: { autoLockEnabled: true } }),
    });
    await expect(svc.authorizeMatchUnlock(bareRequest(), MATCH)).resolves.toEqual({
      userId: 'user-1',
      canOverrideLocked: true,
    });
    expect(assertOrgRole).toHaveBeenCalledWith(ORG, 'user-1', 'editor');
  });

  it('with auto-lock OFF, assigned staff may reopen — and gain the override', async () => {
    // The spread-then-override is the point: the inner call returns
    // `canOverrideLocked: false` and this method flips it to true. Asserting
    // only "resolves" would pass on a version that forgot the flip.
    const { svc } = build({ match: matchRow({ lockConfigJson: { autoLockEnabled: false } }) });
    await expect(svc.authorizeMatchUnlock(staffRequest(), MATCH)).resolves.toEqual({
      staffAccountId: 'staff-1',
      canOverrideLocked: true,
    });
  });

  it('with auto-lock OFF, an unassigned piste is still refused', async () => {
    const { svc } = build({
      assigned: false,
      match: matchRow({ lockConfigJson: { autoLockEnabled: false } }),
    });
    await expect(svc.authorizeMatchUnlock(staffRequest(), MATCH)).rejects.toThrow(
      /not assigned to this Lice/i,
    );
  });

  it('with auto-lock OFF, the role gate still holds', async () => {
    const { svc } = build({
      account: accountRow('checkin'),
      match: matchRow({ lockConfigJson: { autoLockEnabled: false } }),
    });
    await expect(svc.authorizeMatchUnlock(staffRequest(), MATCH)).rejects.toThrow(
      /role cannot use this surface/i,
    );
  });
});

describe('authorizeExchangeScoring', () => {
  it('resolves the match from the exchange and hands off', async () => {
    const { svc } = build({ exchange: { data: { match_id: MATCH }, error: null } });
    await expect(svc.authorizeExchangeScoring(staffRequest(), 'exchange-1')).resolves.toEqual({
      staffAccountId: 'staff-1',
      canOverrideLocked: false,
    });
  });

  it('404s an unknown exchange without touching the match', async () => {
    const { svc, from } = build({ exchange: { data: null, error: null } });
    await expect(svc.authorizeExchangeScoring(staffRequest(), 'nope')).rejects.toThrow(
      /Exchange not found/i,
    );
    expect(queriedTables(from)).not.toContain('matches');
  });

  it('surfaces a driver error rather than reporting not-found', async () => {
    const { svc } = build({ exchange: { data: null, error: { message: 'connection reset' } } });
    await expect(svc.authorizeExchangeScoring(staffRequest(), 'x')).rejects.toThrow(
      /connection reset/,
    );
  });
});

describe('authorizePenaltyScoring', () => {
  it('resolves the match from the penalty and hands off', async () => {
    const { svc } = build({ penalty: { data: { match_id: MATCH }, error: null } });
    await expect(svc.authorizePenaltyScoring(staffRequest(), 'penalty-1')).resolves.toMatchObject({
      staffAccountId: 'staff-1',
    });
  });

  it('404s an unknown penalty without touching the match', async () => {
    const { svc, from } = build({ penalty: { data: null, error: null } });
    await expect(svc.authorizePenaltyScoring(staffRequest(), 'nope')).rejects.toThrow(
      /Penalty not found/i,
    );
    expect(queriedTables(from)).not.toContain('matches');
  });
});

describe('authorizeForfeitOrganizer', () => {
  it('routes to the ORGANIZER check, not the scoring one', async () => {
    // The failure this exists for: swapping the delegate to
    // `authorizeMatchScoring` would let assigned piste staff reverse a forfeit.
    // A staff cookie must be refused with the organizer message, not admitted.
    const { svc } = build({ forfeit: { data: { match_id: MATCH }, error: null } });
    await expect(svc.authorizeForfeitOrganizer(staffRequest(), 'forfeit-1')).rejects.toThrow(
      /Organizer session required/i,
    );
  });

  it('admits an editor', async () => {
    const { svc, assertOrgRole } = build({
      userId: 'user-1',
      forfeit: { data: { match_id: MATCH }, error: null },
    });
    await expect(svc.authorizeForfeitOrganizer(bareRequest(), 'forfeit-1')).resolves.toEqual({
      userId: 'user-1',
      canOverrideLocked: true,
    });
    expect(assertOrgRole).toHaveBeenCalledWith(ORG, 'user-1', 'editor');
  });

  it('404s an unknown forfeit', async () => {
    const { svc } = build({ userId: 'user-1', forfeit: { data: null, error: null } });
    await expect(svc.authorizeForfeitOrganizer(bareRequest(), 'nope')).rejects.toThrow(
      /Forfeit not found/i,
    );
  });
});
