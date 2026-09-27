/**
 * `GET /phases/:phaseId/matches` (ruling 129, the bar of rulings 81-83 and 127): a phase of a
 * DRAFT Event, or of a Tournament that is not published, running or completed, lists nothing for
 * anyone but a member of the Event's club or an ACTIVE staff session of the same Event — exactly
 * what an unknown phase lists. The membership and staff checks run for real over seeded tables;
 * the bout read is stubbed with what the real service answers.
 */
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { MatchesController } from './matches.controller';

const E_OPEN = {
  id: 'e-open',
  status: 'published',
  organization_id: 'org-a',
  event_kind: 'standard',
};
const E_DRAFT = { ...E_OPEN, id: 'e-draft', status: 'draft' };
const phase = (id: string, status: string, events: typeof E_OPEN) => ({
  id,
  tournaments: { status, events },
});
const OPEN = 'ph-open';
const DRAFT_T = 'ph-draft-tournament';
const DRAFT_E = 'ph-draft-event';
const UNKNOWN = 'ph-unknown';
const KNOWN = new Set([OPEN, DRAFT_T, DRAFT_E]);

let db: ReturnType<typeof mockSupabase>;
let listByPhase: ReturnType<typeof vi.fn>;

function controller() {
  const supabase = { service: db.service };
  const orgs = new OrganizationsService(supabase as never);
  return new MatchesController(
    { listByPhase } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    supabase as never,
    orgs,
  );
}

const claimed = (userId: string) => ({ identity: { kind: 'claimed', userId, email: null } });
const staffOf = (staffId: string, eventId: string) => ({ staffSession: { staffId, eventId } });
const list = (phaseId: string, req: object = {}) =>
  controller().listByPhase(phaseId, req as never) as Promise<unknown[]>;

beforeEach(() => {
  db = mockSupabase({
    phases: {
      rows: [
        phase(OPEN, 'running', E_OPEN),
        phase(DRAFT_T, 'draft', E_OPEN),
        phase(DRAFT_E, 'running', E_DRAFT),
      ],
    },
    organization_members: {
      rows: [
        { organization_id: 'org-a', user_id: 'u-member', role: 'read_only' },
        { organization_id: 'org-b', user_id: 'u-owner-b', role: 'owner' },
      ],
    },
    event_staff_accounts: {
      rows: [
        { id: 'staff-open', event_id: 'e-open', status: 'active' },
        { id: 'staff-draft', event_id: 'e-draft', status: 'active' },
        { id: 'staff-off', event_id: 'e-draft', status: 'disabled' },
      ],
    },
  });
  // The real read: a phase's bouts, none for an unknown phase.
  listByPhase = vi.fn(async (id: string) => (KNOWN.has(id) ? [{ id: `m-${id}` }] : []));
});

describe('GET /phases/:phaseId/matches — a hidden phase lists what an unknown one lists (ruling 129)', () => {
  it('lists a public phase to anyone, reading the Tournament status and the Event', async () => {
    expect(await list(OPEN)).toEqual([{ id: `m-${OPEN}` }]);
    expect(selectsFor(db.from, 'phases')).toEqual([
      'tournaments!inner(status, events!inner(id, status, organization_id, event_kind))',
    ]);
  });

  it.each([
    ['a signed-out caller', {}],
    ['a member of another club', claimed('u-owner-b')],
    ["another Event's staff", staffOf('staff-open', 'e-open')],
    ['a disabled staff session', staffOf('staff-off', 'e-draft')],
  ])("answers %s a draft Event's phase exactly as an unknown one", async (_label, req) => {
    expect(await list(DRAFT_E, req)).toEqual(await list(UNKNOWN, req));
    expect(listByPhase).not.toHaveBeenCalledWith(DRAFT_E);
  });

  it.each([
    ['a signed-out caller', {}],
    ['a member of another club', claimed('u-owner-b')],
    ["another Event's staff", staffOf('staff-draft', 'e-draft')],
  ])("answers %s a draft Tournament's phase exactly as an unknown one", async (_label, req) => {
    expect(await list(DRAFT_T, req)).toEqual(await list(UNKNOWN, req));
    expect(listByPhase).not.toHaveBeenCalledWith(DRAFT_T);
  });

  it("lists both to a member of the Event's club", async () => {
    expect(await list(DRAFT_T, claimed('u-member'))).toEqual([{ id: `m-${DRAFT_T}` }]);
    expect(await list(DRAFT_E, claimed('u-member'))).toEqual([{ id: `m-${DRAFT_E}` }]);
  });

  it("lists each to the Event's own active staff session", async () => {
    expect(await list(DRAFT_T, staffOf('staff-open', 'e-open'))).toEqual([{ id: `m-${DRAFT_T}` }]);
    expect(await list(DRAFT_E, staffOf('staff-draft', 'e-draft'))).toEqual([
      { id: `m-${DRAFT_E}` },
    ]);
  });

  it('fails a failed phase read as a 5xx, never as "unknown"', async () => {
    db = mockSupabase({ phases: { data: null, error: { message: 'connection reset' } } });
    const failure = await list(DRAFT_T).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect(listByPhase).not.toHaveBeenCalled();
  });
});
