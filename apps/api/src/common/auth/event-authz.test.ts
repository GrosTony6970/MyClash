import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  assertCanManageEvent,
  assertCanManageLice,
  assertCanManagePool,
  assertCanReadEvent,
  type EventAuthzDeps,
} from './event-authz';
import { ANONYMOUS_USER_ID } from './request-user';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EVENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const LICE_ID = '11111111-1111-4111-8111-111111111111';
const POOL_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER = 'user-in-org-a';
const OUTSIDER = 'user-in-org-b';

/** Dispatches on table name — an ordered mock desyncs the moment a hop moves. */
function makeDeps(
  tables: Record<string, { data: unknown; error: { message: string } | null }>,
  assertOrgRole = vi.fn(),
): { deps: EventAuthzDeps; assertOrgRole: ReturnType<typeof vi.fn> } {
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const key of ['select', 'eq']) c[key] = vi.fn(() => c);
    c['maybeSingle'] = vi.fn(() => Promise.resolve(result));
    return c;
  };
  const from = vi.fn((table: string) => chain(tables[table] ?? { data: null, error: null }));
  return {
    deps: {
      supabase: { service: { from } } as never,
      orgs: { assertOrgRole } as never,
    },
    assertOrgRole,
  };
}

/** Refuses anyone who is not a member of ORG_A, like the real assertion. */
function orgAOnly() {
  return vi.fn((orgId: string, userId: string) => {
    if (orgId !== ORG_A || userId !== MEMBER) {
      return Promise.reject(new ForbiddenException('You are not a member of this organization'));
    }
    return Promise.resolve();
  });
}

describe('assertCanManageEvent', () => {
  it('resolves the org from the event and asserts editor by default', async () => {
    const { deps, assertOrgRole } = makeDeps({
      events: { data: { organization_id: ORG_A }, error: null },
    });

    await expect(assertCanManageEvent(deps, EVENT_ID, MEMBER)).resolves.toBe(ORG_A);
    expect(assertOrgRole).toHaveBeenCalledWith(ORG_A, MEMBER, 'editor');
  });

  /**
   * The whole point of the slice. These routes had NO authorization at all, and
   * every one writes through the service-role client, which is BYPASSRLS — so
   * this assertion is the entire boundary, not defence in depth.
   */
  it('refuses a member of another organisation', async () => {
    const { deps } = makeDeps(
      { events: { data: { organization_id: ORG_A }, error: null } },
      orgAOnly(),
    );

    await expect(assertCanManageEvent(deps, EVENT_ID, OUTSIDER)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('honours a stricter role when one is asked for', async () => {
    const { deps, assertOrgRole } = makeDeps({
      events: { data: { organization_id: ORG_A }, error: null },
    });

    await assertCanManageEvent(deps, EVENT_ID, MEMBER, 'admin');

    expect(assertOrgRole).toHaveBeenCalledWith(ORG_A, MEMBER, 'admin');
  });

  it('404s a missing event rather than asserting against nothing', async () => {
    const { deps, assertOrgRole } = makeDeps({ events: { data: null, error: null } });

    await expect(assertCanManageEvent(deps, EVENT_ID, MEMBER)).rejects.toThrow(NotFoundException);
    expect(assertOrgRole).not.toHaveBeenCalled();
  });

  it('surfaces a failed lookup instead of treating it as "not found"', async () => {
    const { deps } = makeDeps({ events: { data: null, error: { message: 'timeout' } } });

    await expect(assertCanManageEvent(deps, EVENT_ID, MEMBER)).rejects.toThrow(/timeout/);
  });
});

describe('assertCanManageLice', () => {
  it('hops lice → event → org', async () => {
    const { deps, assertOrgRole } = makeDeps({
      lices: { data: { event_id: EVENT_ID }, error: null },
      events: { data: { organization_id: ORG_A }, error: null },
    });

    await expect(assertCanManageLice(deps, LICE_ID, MEMBER)).resolves.toBe(ORG_A);
    expect(assertOrgRole).toHaveBeenCalledWith(ORG_A, MEMBER, 'editor');
  });

  /**
   * Deleting a lice is destructive well beyond its own row: `matches.lice_id`
   * is ON DELETE SET NULL, so it silently unschedules every match on that
   * piste. It had no caller check of any kind.
   */
  it('refuses an outsider deleting a piste', async () => {
    const { deps } = makeDeps(
      {
        lices: { data: { event_id: EVENT_ID }, error: null },
        events: { data: { organization_id: ORG_A }, error: null },
      },
      orgAOnly(),
    );

    await expect(assertCanManageLice(deps, LICE_ID, OUTSIDER)).rejects.toThrow(ForbiddenException);
  });

  it('404s a missing lice', async () => {
    const { deps } = makeDeps({ lices: { data: null, error: null } });

    await expect(assertCanManageLice(deps, LICE_ID, MEMBER)).rejects.toThrow(NotFoundException);
  });
});

describe('assertCanManagePool', () => {
  it('walks pool → phase → tournament → event → org', async () => {
    const { deps, assertOrgRole } = makeDeps({
      pools: { data: { phases: { tournaments: { event_id: EVENT_ID } } }, error: null },
      events: { data: { organization_id: ORG_A }, error: null },
    });

    await expect(assertCanManagePool(deps, POOL_ID, MEMBER)).resolves.toBe(ORG_A);
    expect(assertOrgRole).toHaveBeenCalledWith(ORG_A, MEMBER, 'editor');
  });

  it('refuses an outsider clearing a pool day', async () => {
    const { deps } = makeDeps(
      {
        pools: { data: { phases: { tournaments: { event_id: EVENT_ID } } }, error: null },
        events: { data: { organization_id: ORG_A }, error: null },
      },
      orgAOnly(),
    );

    await expect(assertCanManagePool(deps, POOL_ID, OUTSIDER)).rejects.toThrow(ForbiddenException);
  });

  it('404s when the chain does not resolve to an event', async () => {
    const { deps } = makeDeps({ pools: { data: { phases: null }, error: null } });

    await expect(assertCanManagePool(deps, POOL_ID, MEMBER)).rejects.toThrow(NotFoundException);
  });
});

/**
 * The read gate. `GET /events/:eventId/schedule` is @Public() and its projection
 * carries both fighters' names on every row, so a DRAFT event's entire roster
 * was one request away for anyone holding the id — and the id is not a secret,
 * because `GET /events/:slug` is public too.
 *
 * The rule already existed in SQL and nowhere else: matches_select
 * (0002_rls.sql:523-533) is `is_org_member(org) OR status IN (…)`. Every query
 * on these routes runs as the BYPASSRLS service role, so that policy never
 * executes and this assertion is the entire boundary.
 */
describe('assertCanReadEvent', () => {
  /** Counts calls so "never resolves an identity" is assertable, not assumed. */
  function thunk(userId: string) {
    return vi.fn(() => Promise.resolve(userId));
  }

  const eventRow = (status: string) => ({
    events: { data: { status, organization_id: ORG_A }, error: null },
  });

  /**
   * `archived` is in here ON PURPOSE, unlike matches_select and listEvents:
   * a past event's public page is the reason to keep the event, and archiving
   * is a write lock (EventReadOnlyGuard), not a curtain.
   */
  it.each(['published', 'running', 'completed', 'archived'])(
    'lets anyone read a %s event without ever resolving an identity',
    async (status) => {
      const { deps, assertOrgRole } = makeDeps(eventRow(status));
      const resolve = thunk(ANONYMOUS_USER_ID);

      await expect(assertCanReadEvent(deps, EVENT_ID, resolve)).resolves.toBeUndefined();

      // The thunk exists to keep the GoTrue round-trip off the hot read paths.
      // If it is ever called here, that saving is gone.
      expect(resolve).not.toHaveBeenCalled();
      expect(assertOrgRole).not.toHaveBeenCalled();
    },
  );

  it('hides a draft event from an anonymous caller', async () => {
    const { deps, assertOrgRole } = makeDeps(eventRow('draft'));

    await expect(assertCanReadEvent(deps, EVENT_ID, thunk(ANONYMOUS_USER_ID))).rejects.toThrow(
      NotFoundException,
    );
    expect(assertOrgRole).not.toHaveBeenCalled();
  });

  it('lets a member of the owning org read their own draft', async () => {
    const { deps, assertOrgRole } = makeDeps(eventRow('draft'), orgAOnly());

    await expect(assertCanReadEvent(deps, EVENT_ID, thunk(MEMBER))).resolves.toBeUndefined();
    // read_only is the FLOOR of the hierarchy — any member, matching
    // `is_org_member` in the policy this mirrors. A stricter bar would lock
    // scorekeepers out of the event they are working.
    expect(assertOrgRole).toHaveBeenCalledWith(ORG_A, MEMBER, 'read_only');
  });

  /**
   * 404 and not 403: a 403 confirms the event exists, and the existence of an
   * unannounced event is part of what is being hidden.
   */
  it('404s an outsider on a draft rather than 403ing them', async () => {
    const { deps } = makeDeps(eventRow('draft'), orgAOnly());

    const err = await assertCanReadEvent(deps, EVENT_ID, thunk(OUTSIDER)).catch(
      (e: unknown) => e as Error,
    );

    expect(err).toBeInstanceOf(NotFoundException);
    expect(err).not.toBeInstanceOf(ForbiddenException);
  });

  /**
   * `/schedule` answers `[]` for an unknown id today and its callers depend on
   * that shape. Inventing a 404 here would be a second, unrelated change.
   */
  it('passes through when the event row does not exist', async () => {
    const { deps } = makeDeps({ events: { data: null, error: null } });

    await expect(
      assertCanReadEvent(deps, EVENT_ID, thunk(ANONYMOUS_USER_ID)),
    ).resolves.toBeUndefined();
  });

  it('surfaces a failed lookup instead of treating it as "public"', async () => {
    const { deps } = makeDeps({ events: { data: null, error: { message: 'timeout' } } });

    await expect(assertCanReadEvent(deps, EVENT_ID, thunk(ANONYMOUS_USER_ID))).rejects.toThrow(
      /timeout/,
    );
  });
});
