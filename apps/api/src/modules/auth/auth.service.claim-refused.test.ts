import { ConflictException, HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';
import {
  mockSupabase as seededSupabase,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';

/**
 * A claim the database refuses (operator ruling 300).
 *
 * Lea's account holds the row "Lea Martin" on the roster of an Event. The organiser added a
 * second row with her address at the same Event. The database refuses a second row of one
 * account at an Event (`persons_event_id_claimed_by_user_id_key`, migration 0220, ruling 296).
 * `completeClaim` caught that and only logged it: "this is me" answered "1 claimed", and a claim
 * link landed as a success. Each door now says the refusal, and any other failed write is a
 * plain error.
 */
const LEA = { id: 'user-lea', email: 'lea@example.com', user_metadata: {} };
const ROW = '00000000-0000-0000-0000-00000000000b';
const OK = { data: null, error: null };
const SECOND_ROW_AT_EVENT = {
  data: null,
  error: {
    code: '23505',
    message:
      'duplicate key value violates unique constraint "persons_event_id_claimed_by_user_id_key"',
  },
};
const FAULT = { data: null, error: { code: '08006', message: 'connection refused' } };

const unclaimed = (id: string) => ({
  data: {
    id,
    email: LEA.email,
    claim_status: 'unclaimed',
    claimed_by_user_id: null,
    events: { slug: 'spring-open' },
  },
  error: null,
});
const NO_PROFILE = { data: { global_person_id: null }, error: null };
/** What every later read of `persons` answers: the sign-in autolink finds no row. */
const NO_ROWS = { data: [], error: null };

const verifyOtp = vi.fn();
const config = {
  getOrThrow: vi.fn(),
  get: vi.fn((key: string, def?: string) => (key === 'DOMAIN' ? 'myclash.localhost' : (def ?? ''))),
};

function build(persons: TableSeed) {
  const db = seededSupabase({ persons, global_persons: { rows: [] } });
  const supabase = {
    getAuthUser: vi.fn().mockResolvedValue(LEA),
    service: db.service,
    anon: { auth: { verifyOtp } },
  };
  const service = new AuthService(
    supabase as never,
    { sendMagicLink: vi.fn() } as never,
    config as never,
    {} as never,
    {} as LegalAcceptanceService,
    {} as never,
  );
  const reply = { setCookie: vi.fn(), clearCookie: vi.fn(), send: vi.fn(), redirect: vi.fn() };
  return { service, db, reply };
}

const signedIn = { headers: { authorization: 'Bearer token' }, cookies: {} } as never;

beforeEach(() => {
  vi.clearAllMocks();
  verifyOtp.mockResolvedValue({
    data: {
      session: { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user: LEA },
    },
    error: null,
  });
});

describe('"this is me" on the personal space, `POST /me/claim-persons` (ruling 300)', () => {
  it('counts what landed, and what the database refused for a second row at an Event', async () => {
    const { service, db } = build([
      unclaimed('row-a'),
      OK,
      NO_PROFILE,
      unclaimed('row-b'),
      SECOND_ROW_AT_EVENT,
    ]);

    await expect(service.claimPersons(signedIn, ['row-a', 'row-b'])).resolves.toEqual({
      claimed: 1,
      alreadyAtEvent: 1,
    });
    expect(writesTo(db, 'persons')).toHaveLength(2);
  });

  it('counts two rows that landed, and no refusal', async () => {
    const { service } = build([
      unclaimed('row-a'),
      OK,
      NO_PROFILE,
      unclaimed('row-b'),
      OK,
      NO_PROFILE,
    ]);

    await expect(service.claimPersons(signedIn, ['row-a', 'row-b'])).resolves.toEqual({
      claimed: 2,
      alreadyAtEvent: 0,
    });
  });

  it('fails on any other failed write: a plain error, never a count', async () => {
    const { service } = build([unclaimed('row-a'), FAULT]);

    const failure = await service.claimPersons(signedIn, ['row-a']).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect((failure as Error).message).toContain('connection refused');
  });

  // A row that could not be read was skipped: the answer was "0 claimed", and the page said nothing.
  it('fails on a failed read of the row: a plain error, never "0 claimed"', async () => {
    const { service, db } = build([FAULT]);

    const failure = await service.claimPersons(signedIn, ['row-a']).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect((failure as Error).message).toContain('connection refused');
    expect(writesTo(db, 'persons')).toEqual([]);
  });

  it('skips an id that names no row, and still claims the next one', async () => {
    const { service } = build([{ data: null, error: null }, unclaimed('row-b'), OK, NO_PROFILE]);

    await expect(service.claimPersons(signedIn, ['gone', 'row-b'])).resolves.toEqual({
      claimed: 1,
      alreadyAtEvent: 0,
    });
  });
});

describe('the emailed claim link (ruling 300)', () => {
  const land = (service: AuthService, reply: object) =>
    service.handleCallback('token-hash', 'claim', ROW, undefined, reply as never);

  it('signs her in and sends her to the claim page with the reason', async () => {
    const { service, reply } = build([unclaimed(ROW), SECOND_ROW_AT_EVENT, NO_ROWS]);

    await land(service, reply);

    expect(reply.setCookie.mock.calls.map(([name]) => name)).toEqual([
      'sb-access-token',
      'sb-refresh-token',
    ]);
    expect(reply.redirect.mock.calls).toEqual([
      [
        `https://app.myclash.localhost/e/spring-open/claim?personId=${ROW}&claimRefused=already_at_event`,
      ],
    ]);
  });

  it('fails on any other failed write, and redirects nowhere', async () => {
    const { service, reply } = build([unclaimed(ROW), FAULT, NO_ROWS]);

    await expect(land(service, reply)).rejects.toThrow('connection refused');
    expect(reply.redirect).not.toHaveBeenCalled();
  });
});

describe('the Google claim (ruling 300)', () => {
  const claim = (service: AuthService, reply: object) =>
    service.acceptOAuthSession(
      { accessToken: 'access', refreshToken: 'refresh', mode: 'person_claim', personId: ROW },
      reply as never,
    );

  it('refuses with a coded 409, and sets no cookie', async () => {
    const { service, reply } = build([unclaimed(ROW), SECOND_ROW_AT_EVENT, NO_ROWS]);

    const failure = await claim(service, reply).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(ConflictException);
    expect((failure as ConflictException).getResponse()).toMatchObject({
      code: 'already_at_event',
    });
    expect(reply.setCookie).not.toHaveBeenCalled();
  });
});
