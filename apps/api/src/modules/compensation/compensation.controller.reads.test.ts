/**
 * Who may read an Event's referee compensation: its settings (plan and cap)
 * and the report of what each referee is owed.
 *
 * Until 2026-09-23 both reads resolved no caller at all, so anyone could read
 * any Event's per-referee pay. The bar is an admin of the Event's organisation
 * (operator ruling 63), the bar the settings save and the paid toggle beside
 * them already use; a signed-out caller gets 401 before anything is read.
 *
 * Driven through the controller and the real service over seeded tables. The
 * report itself is stubbed: what it computes is not what this test is about.
 */
import 'reflect-metadata';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { CompensationController } from './compensation.controller';
import { CompensationService } from './compensation.service';

const EVENT_A = '11111111-1111-4111-8111-111111111111';
const EVENT_B = '22222222-2222-4222-8222-222222222222';
const NOBODY = '99999999-9999-4999-8999-999999999999';

let db: ReturnType<typeof mockSupabase>;
let service: CompensationService;
let controller: CompensationController;

beforeEach(() => {
  db = mockSupabase({
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
        { organization_id: 'org-a', user_id: 'u-owner-a', role: 'owner' },
        { organization_id: 'org-a', user_id: 'u-editor-a', role: 'editor' },
        { organization_id: 'org-a', user_id: 'u-member-a', role: 'read_only' },
      ],
    },
    referee_compensation_event_settings: {
      rows: [
        {
          event_id: EVENT_A,
          plan_id: 'plan-a',
          max_compensation_amount: 200,
          min_compensation_amount: null,
          referee_compensation_plans: { name: 'Club A plan' },
        },
      ],
    },
  });
  // The token IS the user id here; no token at all is the anonymous caller.
  const supabase = {
    service: db.service,
    getAuthUser: vi.fn(async (token: string) => ({ id: token })),
  };
  service = new CompensationService(supabase as never);
  vi.spyOn(service, 'computeReport').mockResolvedValue({ referees: [] } as never);
  controller = new CompensationController(service, supabase as never);
});

/** A request from `userId`; none = no token. */
function req(userId?: string) {
  return {
    headers: userId ? { authorization: `Bearer ${userId}` } : {},
    cookies: {},
  } as never;
}

const READS = [
  {
    handler: 'getEventSettings',
    call: (id: string, r: never) => controller.getEventSettings(id, r),
  },
  { handler: 'getReport', call: (id: string, r: never) => controller.getReport(id, r) },
];

describe('CompensationController reads', () => {
  it.each(READS)('$handler refuses a caller with no token, before any read', async (read) => {
    await expect(read.call(EVENT_A, req())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(queriedTables(db.from)).toEqual([]);
    expect(service.computeReport).not.toHaveBeenCalled();
  });

  it.each(READS)(
    '$handler refuses an outsider, an admin of another club, and members below admin, with one answer',
    async (read) => {
      const answers: unknown[] = [];
      for (const caller of ['u-stranger', 'u-admin-b', 'u-editor-a', 'u-member-a']) {
        const refusal = await read.call(EVENT_A, req(caller)).catch((error: unknown) => error);
        expect(refusal, caller).toBeInstanceOf(ForbiddenException);
        answers.push((refusal as ForbiddenException).getResponse());
      }
      expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1);
      expect(service.computeReport).not.toHaveBeenCalled();
    },
  );

  it.each(READS)('$handler answers 404 for an Event that does not exist', async (read) => {
    await expect(read.call(NOBODY, req('u-admin-a'))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets an admin or owner of the Event read its settings', async () => {
    for (const caller of ['u-admin-a', 'u-owner-a']) {
      await expect(controller.getEventSettings(EVENT_A, req(caller))).resolves.toMatchObject({
        planId: 'plan-a',
        planName: 'Club A plan',
      });
    }
  });

  it("lets an admin of the Event read its report, and computes that Event's", async () => {
    await controller.getReport(EVENT_A, req('u-admin-a'));
    expect(service.computeReport).toHaveBeenCalledWith(EVENT_A);
  });

  it("checks the Event the route names against the caller's organisation", async () => {
    await expect(controller.getReport(EVENT_B, req('u-admin-a'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(controller.getReport(EVENT_B, req('u-admin-b'))).resolves.toBeDefined();
  });

  it('reads each deciding column', async () => {
    await controller.getEventSettings(EVENT_A, req('u-admin-a'));
    // The double hands back the whole row whatever is selected.
    expect(selectsFor(db.from, 'events')).toEqual(['organization_id']);
    expect(selectsFor(db.from, 'organization_members')).toEqual(['role']);
  });
});
