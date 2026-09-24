/**
 * Who may generate a Tournament's Pools, `POST tournaments/:id/generate-pools`
 * (operator ruling 103): an admin of the Event's club — the bar of the Swiss
 * generate (ruling 34), the bracket slots (ruling 33) and this controller's
 * other Pool writes. The "discard scored bouts" override keeps its owner-only
 * check in the service.
 *
 * Until 2026-09-24 the club was checked only on that override: anyone at all
 * could throw away and rebuild the Pool layout of a Tournament with no scored
 * bout yet.
 *
 * Driven through the controller with the real organization check over seeded
 * tables. The Pools service is a stub, so "refused" means "never reached".
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { PhasesController } from './phases.controller';

const T_A = '11111111-1111-4111-8111-111111111111';
const EVENT_A = '22222222-2222-4222-8222-222222222222';
const EVENT_B = '33333333-3333-4333-8333-333333333333';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';
const DTO = { poolCount: 2 };

let db: ReturnType<typeof mockSupabase>;
let generatePools: Mock;
let controller: PhasesController;

beforeEach(() => {
  db = mockSupabase({
    tournaments: { rows: [{ id: T_A, event_id: EVENT_A }] },
    events: {
      rows: [
        { id: EVENT_B, organization_id: 'org-b' },
        { id: EVENT_A, organization_id: 'org-a' },
      ],
    },
    organization_members: {
      rows: [
        { organization_id: 'org-b', user_id: 'u-admin-b', role: 'admin' },
        { organization_id: 'org-a', user_id: 'u-admin-a', role: 'admin' },
        // The role just below the bar, in the Tournament's own club.
        { organization_id: 'org-a', user_id: 'u-editor-a', role: 'editor' },
      ],
    },
  });
  generatePools = vi.fn().mockResolvedValue({ phaseId: 'p-1' });
  // The token IS the user id here; no token at all is the signed-out caller.
  const supabase = {
    service: db.service,
    anon: {
      auth: { getUser: vi.fn(async (token: string) => ({ data: { user: { id: token } } })) },
    },
  };
  controller = new PhasesController(
    { generatePools } as never,
    supabase as never,
    new OrganizationsService(supabase as never),
  );
});

/** A request from `userId`; none = no token. */
function req(userId?: string) {
  return { headers: userId ? { authorization: `Bearer ${userId}` } : {}, cookies: {} } as never;
}

const generate = (tournamentId: string, userId?: string, force?: string) =>
  controller.generatePools(tournamentId, DTO as never, req(userId), force);

describe('POST tournaments/:id/generate-pools (ruling 103)', () => {
  it("lets an admin of the Event's club generate", async () => {
    await generate(T_A, 'u-admin-a', 'true');
    expect(generatePools).toHaveBeenCalledWith(T_A, DTO, true, 'u-admin-a');
  });

  it.each([
    ["an editor of the Event's club", 'u-editor-a'],
    ['an admin of another club', 'u-admin-b'],
    ['a signed-out caller', undefined],
  ])('refuses %s, before generating anything', async (_label, userId) => {
    await expect(generate(T_A, userId)).rejects.toThrow(ForbiddenException);
    expect(generatePools).not.toHaveBeenCalled();
  });

  // Over HTTP the read-only guard (@BlockOnCompletedEvent) answers an unknown
  // Tournament with a 403 before this handler runs; this pins the handler.
  it("answers an unknown Tournament with the handler's 404, generating nothing", async () => {
    await expect(generate(UNKNOWN, 'u-admin-a')).rejects.toThrow(
      new NotFoundException(`Tournament ${UNKNOWN} not found`),
    );
    expect(generatePools).not.toHaveBeenCalled();
  });

  it("reads the Tournament's Event, the Event's club and the caller's role only", async () => {
    await generate(T_A, 'u-admin-a');
    expect(selectsFor(db.from, 'tournaments')).toEqual(['event_id']);
    expect(selectsFor(db.from, 'events')).toEqual(['organization_id']);
    expect(selectsFor(db.from, 'organization_members')).toEqual(['role']);
  });
});
