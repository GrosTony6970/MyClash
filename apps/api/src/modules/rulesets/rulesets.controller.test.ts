import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { RulesetsController } from './rulesets.controller';
import type { SelectableRulesetsService } from './selectable-rulesets.service';
import { createRulesetRegistry } from './ruleset-registry';

function makeController(overrides?: {
  selectable?: Partial<SelectableRulesetsService>;
  eventRow?: unknown;
  assertOrgRole?: ReturnType<typeof vi.fn>;
}) {
  const reading = (data: unknown) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  });
  const supabase = {
    service: {
      from: vi.fn(() => reading(overrides?.eventRow ?? null)),
    },
    getAuthUser: vi.fn().mockResolvedValue({ id: 'u1' }),
  };
  const assertOrgRole = overrides?.assertOrgRole ?? vi.fn().mockResolvedValue(undefined);
  const selectable = {
    listForOrganization: vi.fn().mockResolvedValue([]),
    draftsOfferedTo: vi.fn().mockResolvedValue(false),
    ...overrides?.selectable,
  };
  const controller = new RulesetsController(
    selectable as never,
    supabase as never,
    {
      assertOrgRole,
    } as never,
    createRulesetRegistry(),
  );
  return { controller, selectable, assertOrgRole };
}

// Carries a bearer token: resolveRequestUserId short-circuits to 'anonymous'
// without one, which would make the role assertions below test nothing.
const req = { headers: { authorization: 'Bearer tok' }, cookies: {} } as never;
const EVENT_ID = '11111111-1111-1111-1111-111111111111';

describe('RulesetsController.list', () => {
  it('returns the registry list mapped to the summary shape', () => {
    const { controller } = makeController();
    const result = controller.list();

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
    for (const entry of result) {
      expect(entry).toMatchObject({
        code: expect.any(String),
        version: expect.any(String),
        label: expect.any(String),
      });
    }
    // The well-known TF_v1 ruleset must be present.
    expect(result.find((r) => r.code === 'TF_v1')).toBeDefined();
  });

  it('marks coded rulesets as not custom', () => {
    const { controller } = makeController();
    expect(controller.list().every((r) => r.custom === false)).toBe(true);
  });

  it('lists the latest version of a built-in only, as the event picker does', () => {
    const { controller } = makeController();
    expect(
      controller
        .list()
        .filter((r) => r.code === 'TF_v1')
        .map((r) => r.version),
    ).toEqual(['1.1.0']);
  });
});

describe('RulesetsController.listForEvent', () => {
  it('404s on an unknown event rather than falling back to a bare catalog', async () => {
    const { controller } = makeController({ eventRow: null });
    await expect(controller.listForEvent(EVENT_ID, req)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("requires the same 'admin' role createTournament asserts, on the event's org", async () => {
    // If this ever drops below 'admin' it starts showing an organization's
    // private rulesets to members who could not create a tournament with them.
    const { controller, assertOrgRole } = makeController({
      eventRow: { organization_id: 'org-1' },
    });
    await controller.listForEvent(EVENT_ID, req);
    expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'u1', 'admin');
  });

  it('refuses when the org-role assertion throws, without reaching the catalog', async () => {
    const assertOrgRole = vi.fn().mockRejectedValue(new Error('not a member'));
    const { controller, selectable } = makeController({
      eventRow: { organization_id: 'org-1' },
      assertOrgRole,
    });
    await expect(controller.listForEvent(EVENT_ID, req)).rejects.toThrow('not a member');
    expect(selectable.listForOrganization).not.toHaveBeenCalled();
  });

  it("scopes the catalog to the event's organization, with no drafts", async () => {
    const { controller, selectable } = makeController({ eventRow: { organization_id: 'org-1' } });
    await controller.listForEvent(EVENT_ID, req);
    expect(selectable.listForOrganization).toHaveBeenCalledWith('org-1', { withDrafts: false });
  });

  it('offers the drafts to whom `draftsOfferedTo` names: the one owner', async () => {
    const { controller, selectable } = makeController({
      eventRow: { organization_id: 'org-1' },
      selectable: { draftsOfferedTo: vi.fn().mockResolvedValue(true) },
    });
    await controller.listForEvent(EVENT_ID, req);
    expect(selectable.draftsOfferedTo).toHaveBeenCalledWith('u1');
    expect(selectable.listForOrganization).toHaveBeenCalledWith('org-1', { withDrafts: true });
  });
});
