/**
 * Who is enrolling, cancelling or rating? The four participant routes of the
 * workshops controller ask `ParticipantIdentityService`, the one owner of
 * "which person is the caller at this Event".
 *
 * They used to ask a private copy that read the guest cookie WITHOUT checking
 * its signature ("guard already verified" — but the guard runs in shadow mode,
 * and for a signed-in caller its identity is the Supabase token, not this
 * cookie). A cookie anyone could write enrolled or cancelled any person.
 *
 * Driven through the real controller, the real identity owner and the real JWT
 * signer over seeded tables, so a forged cookie is exactly what an attacker
 * would send: a token signed with a secret that is not the server's.
 */
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { GuestJwtService } from '../auth/guest-jwt.service';
import { ParticipantIdentityService } from '../auth/participant-identity.service';
import { WorkshopsController } from './workshops.controller';

const SECRET = 'the-server-guest-secret';
const EVENT = 'event-1';
const OTHER_EVENT = 'event-2';
const SESSION = 'session-1';
const WORKSHOP = 'workshop-1';
const ANNA = 'person-anna';

const TABLES = {
  workshop_sessions: { rows: [{ id: SESSION, workshops: { event_id: EVENT } }] },
  workshops: { rows: [{ id: WORKSHOP, event_id: EVENT }] },
  guest_sessions: {
    rows: [
      { id: 'gs-live', revoked_at: null },
      { id: 'gs-signed-out', revoked_at: '2027-05-22T08:00:00+00:00' },
    ],
  },
};

function controller(tables: Parameters<typeof mockSupabase>[0] = TABLES) {
  const db = mockSupabase(tables);
  const supabase = { ...db, anon: { auth: { getUser: vi.fn() } } };
  const guestJwt = new GuestJwtService({ getOrThrow: () => SECRET } as never);
  const identity = new ParticipantIdentityService(supabase as never, guestJwt);
  // Each takes (target, personId, …): the person is what these tests are about.
  const enrollment = {
    enroll: vi.fn(async (_session: string, _person: string) => ({})),
    cancel: vi.fn(async (_session: string, _person: string) => undefined),
  };
  const feedback = {
    submitFeedback: vi.fn(async (_workshop: string, _person: string, ..._rest: unknown[]) => ({})),
    getMyFeedback: vi.fn(async (_workshop: string, _person: string) => null),
  };
  const c = new WorkshopsController(
    {} as never,
    enrollment as never,
    supabase as never,
    {} as never,
    feedback as never,
    identity,
  );
  return { c, enrollment, feedback };
}

const cookie = (claims: { sub: string; person_id: string; event_id: string }, secret = SECRET) =>
  ({
    cookies: { mc_guest: jwt.sign({ ...claims, type: 'guest' }, secret, { expiresIn: 3600 }) },
  }) as never;

const live = { sub: 'gs-live', person_id: ANNA, event_id: EVENT };

/** Each participant route, and the service call it would make for the caller. */
const ROUTES = [
  ['enrol', (t: ReturnType<typeof controller>, req: never) => t.c.enroll(SESSION, req)],
  ['cancel', (t: ReturnType<typeof controller>, req: never) => t.c.cancel(SESSION, req)],
  [
    'rate',
    (t: ReturnType<typeof controller>, req: never) =>
      t.c.submitFeedback(WORKSHOP, { rating: 5 } as never, req),
  ],
  [
    'read my rating',
    (t: ReturnType<typeof controller>, req: never) => t.c.myFeedback(WORKSHOP, req),
  ],
] as const;

const acted = (t: ReturnType<typeof controller>) => [
  ...t.enrollment.enroll.mock.calls,
  ...t.enrollment.cancel.mock.calls,
  ...t.feedback.submitFeedback.mock.calls,
  ...t.feedback.getMyFeedback.mock.calls,
];

afterEach(() => vi.clearAllMocks());

describe('workshops — the participant routes act only for a caller the server can vouch for', () => {
  it.each(ROUTES)('%s: refuses a guest cookie the server never signed', async (_name, call) => {
    const t = controller();
    const forged = cookie(live, 'an-attacker-secret');
    await expect(call(t, forged)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(acted(t)).toEqual([]);
  });

  it.each(ROUTES)('%s: refuses a real guest cookie for another Event', async (_name, call) => {
    const t = controller();
    await expect(call(t, cookie({ ...live, event_id: OTHER_EVENT }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(acted(t)).toEqual([]);
  });

  it.each(ROUTES)('%s: refuses a guest session that was signed out', async (_name, call) => {
    const t = controller();
    await expect(call(t, cookie({ ...live, sub: 'gs-signed-out' }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(acted(t)).toEqual([]);
  });

  it.each(ROUTES)('%s: acts for the person a live guest session names', async (_name, call) => {
    const t = controller();
    await call(t, cookie(live));
    expect(acted(t).map((args) => args[1])).toEqual([ANNA]);
  });

  it('answers a session or workshop that does not exist with a 404, and acts for nobody', async () => {
    const t = controller();
    await expect(t.c.enroll('no-such-session', cookie(live))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(t.c.myFeedback('no-such-workshop', cookie(live))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(acted(t)).toEqual([]);
  });

  it('does not call a workshop missing when its read fails', async () => {
    const failed = { data: null, error: { message: 'connection reset' } };
    const t = controller({ ...TABLES, workshop_sessions: failed, workshops: failed });
    for (const attempt of [
      () => t.c.enroll(SESSION, cookie(live)),
      () => t.c.myFeedback(WORKSHOP, cookie(live)),
    ]) {
      const refusal = attempt();
      await expect(refusal).rejects.toThrow(/connection reset/);
      await expect(refusal).rejects.not.toBeInstanceOf(NotFoundException);
    }
    expect(acted(t)).toEqual([]);
  });
});
