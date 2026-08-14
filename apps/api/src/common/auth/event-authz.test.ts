import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  assertCanManageEvent,
  assertCanManageLice,
  assertCanManagePool,
  type EventAuthzDeps,
} from './event-authz';

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
