import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { StaffService, STAFF_COOKIE_NAME } from './staff.service';
import { mockSupabase, queriedTables, type TableSeed } from '../../common/testing/supabase-chain';

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
 *
 * Every table here is SEEDED rather than canned, and each one carries a decoy
 * belonging to the OTHER event. That is what makes the `.eq()` in each query
 * decide something: a canned fixture hands back the same row however the query
 * is scoped, so a lost `.eq('id', …)` reads as a passing test. Decoys are seeded
 * FIRST on purpose — these reads all end in `maybeSingle`, which takes the first
 * surviving row, so a decoy sorted behind the real one could never be returned
 * and the fixture would assert nothing.
 */

const ORG = 'org-1';
const EVENT = 'event-1';
const MATCH = 'match-1';
const LICE = 'lice-1';
const ACCOUNT = 'staff-1';

/** The neighbouring event every decoy belongs to. */
const OTHER_ORG = 'org-2';
const OTHER_EVENT = 'event-2';
const OTHER_MATCH = 'match-2';
const OTHER_LICE = 'lice-2';
const OTHER_ACCOUNT = 'staff-2';

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
 * Last year's event, and COMPLETED — so a staff session that reads the wrong
 * event row is refused by `assertEventScorable` rather than quietly scoring
 * against it.
 */
const OTHER_EVENT_ROW = {
  ...EVENT_ROW,
  id: OTHER_EVENT,
  organization_id: OTHER_ORG,
  slug: 'fal-2025',
  status: 'completed',
};

/**
 * The nested shape `getMatchContext` unwraps. PostgREST returns embedded
 * to-one rows as an object OR a single-element array depending on the relation,
 * and the service handles both — `nest: 'array'` exercises the branch nothing
 * else covers.
 */
function matchRow(
  opts: {
    id?: string;
    liceId?: string | null;
    eventId?: string;
    orgId?: string;
    lockConfigJson?: unknown;
    eventStatus?: string;
    nest?: 'object' | 'array';
  } = {},
) {
  const tournament = {
    id: 'tournament-1',
    event_id: opts.eventId ?? EVENT,
    lock_config_json: opts.lockConfigJson ?? null,
    events: { organization_id: opts.orgId ?? ORG, status: opts.eventStatus ?? 'running' },
  };
  const phases =
    opts.nest === 'array' ? [{ tournaments: [tournament] }] : { tournaments: tournament };
  return { id: opts.id ?? MATCH, lice_id: opts.liceId === undefined ? LICE : opts.liceId, phases };
}

/**
 * The bout in the other event. It differs on BOTH axes the two branches read —
 * event for the staff branch, organisation for the organizer one — so losing
 * `getMatchContext`'s `.eq('id', …)` is refused whichever way the caller came in.
 */
const DECOY_MATCH = matchRow({
  id: OTHER_MATCH,
  eventId: OTHER_EVENT,
  orgId: OTHER_ORG,
  liceId: OTHER_LICE,
});

function accountRow(role: string, status = 'active', over: Record<string, unknown> = {}) {
  return {
    id: ACCOUNT,
    event_id: EVENT,
    display_name: 'Marie Dubois',
    username: 'marie',
    pin_hash: 'x',
    status,
    role,
    ...over,
  };
}

/**
 * One decoy per axis of `getAccountForEvent`'s two-filter read: same id in
 * another event, and another id in this event. Both are `checkin` accounts, a
 * role the scoring surfaces refuse — so whichever filter is lost, the wrong row
 * comes back and the role gate names it.
 */
const ACCOUNT_DECOYS = [
  accountRow('checkin', 'active', { event_id: OTHER_EVENT }),
  accountRow('checkin', 'active', { id: OTHER_ACCOUNT }),
];

/**
 * `isLiceAssigned` answers a BOOLEAN, so a decoy only bites where the answer
 * should be "no": both rows below are assignments that exist but are not this
 * account on this piste. They are the whole seed when `assigned: false`, so a
 * lost filter turns a refusal into an admission.
 */
const ASSIGNMENT = { id: 'assignment-1', staff_account_id: ACCOUNT, lice_id: LICE };
const ASSIGNMENT_DECOYS = [
  { id: 'assignment-2', staff_account_id: OTHER_ACCOUNT, lice_id: LICE },
  { id: 'assignment-3', staff_account_id: ACCOUNT, lice_id: OTHER_LICE },
];

/**
 * `exchanges`, `match_penalties` and `match_forfeits` are one shape: a row that
 * names the match to authorise against. `'found'` seeds the wanted row behind a
 * decoy pointing at the other event's bout; `'missing'` seeds only that decoy,
 * so a lost `.eq('id', …)` authorises a bout the caller never named instead of
 * 404ing. A driver error cannot come from a seeded table, so it stays canned.
 */
type PointerSeed = 'found' | 'missing' | { error: string };

function pointerSeed(id: string, seed: PointerSeed): TableSeed {
  if (typeof seed === 'object') return { data: null, error: { message: seed.error } };
  const decoy = { id: `${id}-elsewhere`, match_id: OTHER_MATCH };
  return { rows: seed === 'found' ? [decoy, { id, match_id: MATCH }] : [decoy] };
}

const staffRequest = () =>
  ({ cookies: { [STAFF_COOKIE_NAME]: 'token' }, headers: {} }) as unknown as FastifyRequest;
const bareRequest = () => ({ cookies: {}, headers: {} }) as unknown as FastifyRequest;

interface BuildOpts {
  /** Present = organizer branch; absent = staff branch. */
  userId?: string | null;
  /** Throws for the roles listed, resolves otherwise. */
  denyRoles?: readonly string[];
  /** `null` seeds the decoy alone, so the wanted match does not exist. */
  match?: Record<string, unknown> | null;
  account?: Record<string, unknown>;
  assigned?: boolean;
  exchange?: PointerSeed;
  penalty?: PointerSeed;
  forfeit?: PointerSeed;
}

function build(opts: BuildOpts = {}) {
  const match = opts.match === undefined ? matchRow() : opts.match;
  const tables: Record<string, TableSeed> = {
    matches: { rows: match ? [DECOY_MATCH, match] : [DECOY_MATCH] },
    events: { rows: [OTHER_EVENT_ROW, EVENT_ROW] },
    event_staff_accounts: { rows: [...ACCOUNT_DECOYS, opts.account ?? accountRow('scoring')] },
    event_staff_lice_assignments: {
      rows: opts.assigned === false ? ASSIGNMENT_DECOYS : [...ASSIGNMENT_DECOYS, ASSIGNMENT],
    },
  };
  if (opts.exchange) tables['exchanges'] = pointerSeed('exchange-1', opts.exchange);
  if (opts.penalty) tables['match_penalties'] = pointerSeed('penalty-1', opts.penalty);
  if (opts.forfeit) tables['match_forfeits'] = pointerSeed('forfeit-1', opts.forfeit);

  const supabase = mockSupabase(tables);
  const assertOrgRole = vi.fn((_org: string, _user: string, role: string) => {
    if (opts.denyRoles?.includes(role)) return Promise.reject(new ForbiddenException('no role'));
    return Promise.resolve(undefined);
  });
  const jwt = { verify: () => ({ sub: ACCOUNT, event_id: EVENT, type: 'staff' }) };

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
      // The ONLY place this is granted. It is not `canOverrideLocked` under
      // another name: that one means "may edit past the lock" and reaches a pad
      // staff token when auto-lock is off, which is the wrong authority for
      // throwing away a bout somebody else fought.
      canDiscardDependentResults: true,
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
      canDiscardDependentResults: true,
    });
    expect(assertOrgRole).toHaveBeenCalledWith(ORG, 'user-1', 'editor');
  });

  /**
   * The lock override is NOT the discard capability. This is the case that
   * makes them different: with auto-lock off, a pad staff token gets
   * `canOverrideLocked` here — and must still not be able to throw away a bout
   * that has already been fought.
   */
  it('with auto-lock OFF, staff gain the lock override but NOT the discard power', async () => {
    const { svc } = build({ match: matchRow({ lockConfigJson: { autoLockEnabled: false } }) });
    const actor = await svc.authorizeMatchUnlock(staffRequest(), MATCH);
    expect(actor.canOverrideLocked).toBe(true);
    expect(actor.canDiscardDependentResults).toBeUndefined();
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
    const { svc } = build({ exchange: 'found' });
    await expect(svc.authorizeExchangeScoring(staffRequest(), 'exchange-1')).resolves.toEqual({
      staffAccountId: 'staff-1',
      canOverrideLocked: false,
    });
  });

  it('404s an unknown exchange without touching the match', async () => {
    const { svc, from } = build({ exchange: 'missing' });
    await expect(svc.authorizeExchangeScoring(staffRequest(), 'nope')).rejects.toThrow(
      /Exchange not found/i,
    );
    expect(queriedTables(from)).not.toContain('matches');
  });

  it('surfaces a driver error rather than reporting not-found', async () => {
    const { svc } = build({ exchange: { error: 'connection reset' } });
    await expect(svc.authorizeExchangeScoring(staffRequest(), 'x')).rejects.toThrow(
      /connection reset/,
    );
  });
});

describe('authorizePenaltyScoring', () => {
  it('resolves the match from the penalty and hands off', async () => {
    const { svc } = build({ penalty: 'found' });
    await expect(svc.authorizePenaltyScoring(staffRequest(), 'penalty-1')).resolves.toMatchObject({
      staffAccountId: 'staff-1',
    });
  });

  it('404s an unknown penalty without touching the match', async () => {
    const { svc, from } = build({ penalty: 'missing' });
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
    const { svc } = build({ forfeit: 'found' });
    await expect(svc.authorizeForfeitOrganizer(staffRequest(), 'forfeit-1')).rejects.toThrow(
      /Organizer session required/i,
    );
  });

  it('admits an editor', async () => {
    const { svc, assertOrgRole } = build({
      userId: 'user-1',
      forfeit: 'found',
    });
    await expect(svc.authorizeForfeitOrganizer(bareRequest(), 'forfeit-1')).resolves.toEqual({
      userId: 'user-1',
      canOverrideLocked: true,
      canDiscardDependentResults: true,
    });
    expect(assertOrgRole).toHaveBeenCalledWith(ORG, 'user-1', 'editor');
  });

  it('404s an unknown forfeit', async () => {
    const { svc } = build({ userId: 'user-1', forfeit: 'missing' });
    await expect(svc.authorizeForfeitOrganizer(bareRequest(), 'nope')).rejects.toThrow(
      /Forfeit not found/i,
    );
  });
});
