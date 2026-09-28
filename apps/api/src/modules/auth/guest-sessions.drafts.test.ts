/**
 * POST /events/:eventId/guest-sessions (ruling 129, the person page's "This is me"; rulings 167,
 * 168): picking a person entered only in Tournaments hidden from the caller answers exactly as
 * picking an unknown person — the person page's own 404, no session, no cookie, no name — for
 * anyone but a member of the Event's club or an ACTIVE staff session of the same Event. Before,
 * it answered 201 with her name. A referee or instructor of the Event stays. The door holds the
 * person page's gate itself (`readEventPerson`), so the two cannot drift apart.
 */
import { HttpException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo, type TableSeed } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { GuestJwtService } from './guest-jwt.service';
import { GuestSessionsController } from './guest-sessions.controller';

const EVENT = '11111111-1111-4111-8111-111111111111';
const LEA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // the draft only
const REF = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // the draft only, but referees the Event
const NOBODY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const person = (id: string) => ({
  id,
  event_id: EVENT,
  given_name: 'Léa',
  family_name: 'Martin',
  email: 'lea@example.com',
  claim_status: 'unclaimed',
  global_person_id: `gp-${id}`,
});

const SEED: Record<string, TableSeed> = {
  events: {
    rows: [
      {
        id: EVENT,
        status: 'published',
        organization_id: 'org-a',
        event_kind: 'standard',
        end_date: '2027-05-23',
      },
    ],
  },
  tournaments: { rows: [{ id: 't-secret', event_id: EVENT, status: 'draft' }] },
  persons: { rows: [person(LEA), person(REF)] },
  registrations: {
    rows: [
      { id: 'r-lea', person_id: LEA, tournament_id: 't-secret', status: 'registered' },
      { id: 'r-ref', person_id: REF, tournament_id: 't-secret', status: 'registered' },
    ],
  },
  event_referees: { rows: [{ event_id: EVENT, person_id: `gp-${REF}` }] },
  event_instructors: { rows: [] },
  organization_members: {
    rows: [{ organization_id: 'org-a', user_id: 'u-member', role: 'read_only' }],
  },
  event_staff_accounts: {
    rows: [
      { id: 'staff-e1', event_id: EVENT, status: 'active' },
      { id: 'staff-off', event_id: EVENT, status: 'disabled' },
    ],
  },
  guest_sessions: {
    rows: [],
    returning: { id: 'gs-new', device_label: 'Unknown device', expires_at: '2027-05-30' },
  },
};

function mint(overrides: Record<string, TableSeed> = {}) {
  const db = mockSupabase({ ...SEED, ...overrides });
  const config = { getOrThrow: () => 'the-server-guest-secret', get: () => 'test' };
  const controller = new GuestSessionsController(
    db as never,
    new GuestJwtService(config as never),
    config as never,
    { recordForGuestSession: vi.fn(async () => undefined) } as never,
    new OrganizationsService(db as never),
  );
  const setCookie = vi.fn();
  const send = vi.fn();
  const reply = { setCookie, status: vi.fn(() => ({ send })) };
  const pick = (personId: string, req: object = {}) =>
    controller
      .create(EVENT, { person_id: personId }, { headers: {}, ...req } as never, reply as never)
      .then(
        () => 'opened',
        (error: unknown) => error,
      );
  return { db, pick, setCookie, send };
}

const claimed = (userId: string) => ({ identity: { kind: 'claimed', userId, email: null } });
const staffOf = (staffId: string) => ({ staffSession: { staffId, eventId: EVENT } });

describe('POST /guest-sessions answers a draft-only entrant as an unknown person (ruling 129)', () => {
  it.each([
    ['a signed-out caller', {}],
    ['a member of another club', claimed('u-stranger')],
    ['a disabled staff session', staffOf('staff-off')],
  ])('to %s: 404, no session, no cookie, no name', async (_who, req) => {
    const hidden = mint();
    const unknown = mint();
    const refused = await hidden.pick(LEA, req);
    const nobody = await unknown.pick(NOBODY, req);
    expect(refused).toBeInstanceOf(NotFoundException);
    expect(nobody).toBeInstanceOf(NotFoundException);
    expect((refused as Error).message).toBe(`Person "${LEA}" not found`);
    expect((nobody as Error).message).toBe(`Person "${NOBODY}" not found`);
    expect(writesTo(hidden.db, 'guest_sessions')).toEqual([]);
    expect(hidden.setCookie).not.toHaveBeenCalled();
    expect(hidden.send).not.toHaveBeenCalled();
  });

  it.each([
    ["a member of the Event's club", claimed('u-member')],
    ["the Event's active staff session", staffOf('staff-e1')],
  ])('opens a session for %s', async (_who, req) => {
    const t = mint();
    expect(await t.pick(LEA, req)).toBe('opened');
    expect(t.setCookie).toHaveBeenCalledTimes(1);
  });

  it('opens a session for anyone on a referee of the Event, though entered only in the draft', async () => {
    const t = mint();
    expect(await t.pick(REF)).toBe('opened');
    expect(t.send.mock.calls[0]?.[0]).toMatchObject({ person: { id: REF } });
  });

  it.each(['events', 'persons', 'registrations'])(
    'fails a failed %s read as a 5xx, never as "not found", and opens nothing',
    async (table) => {
      const t = mint({ [table]: { data: null, error: { message: 'boom' } } });
      const failed = await t.pick(LEA);
      expect(failed).toBeInstanceOf(Error);
      expect(failed).not.toBeInstanceOf(HttpException);
      expect(writesTo(t.db, 'guest_sessions')).toEqual([]);
    },
  );
});
