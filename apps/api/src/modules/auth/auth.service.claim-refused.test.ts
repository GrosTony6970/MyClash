import { HttpException, Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';
import {
  filtersFor,
  mockSupabase as seededSupabase,
  selectsFor,
  writesTo,
  type ChainResult,
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
/** A claim write that landed: it hands back the row it wrote (ruling 581). */
const OK = { data: [{ id: ROW }], error: null };
/** A claim write that hit no row: another account took it after the check (ruling 581). */
const LOST = { data: [], error: null };
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
        `https://app.myclash.localhost/auth/signed-in?next=${encodeURIComponent(
          `/e/spring-open/claim?personId=${ROW}&claimRefused=already_at_event`,
        )}`,
      ],
    ]);
  });

  it('fails on any other failed write, and redirects nowhere', async () => {
    const { service, reply } = build([unclaimed(ROW), FAULT, NO_ROWS]);

    await expect(land(service, reply)).rejects.toThrow('connection refused');
    expect(reply.redirect).not.toHaveBeenCalled();
  });

  // Asking for the link: the 400 says nothing of why a row could not be read; the log keeps it.
  it('logs why the row could not be read when the link is asked for', async () => {
    const { service } = build([FAULT]);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const asked = service.requestMagicLink({ email: LEA.email, type: 'claim', personId: ROW });
      await expect(asked).rejects.toThrow('Could not validate profile');
      expect(warn).toHaveBeenCalledWith(`claim check of person ${ROW} failed: connection refused`);
    } finally {
      warn.mockRestore();
    }
  });
});

/**
 * The race (rulings 581-583). An organiser changes a row's address from Lea's to Tom's. At that
 * instant Lea presses "This is me": her check reads the row before the change, the organiser's
 * save hands the row to Tom, then Lea's write lands. It used to take the row from Tom. The write
 * now lands only on the row the check passed — held by nobody else, still at the address it read —
 * and one it missed reads the row again for the reason. The canned write answers no row, as the
 * database does when its filter misses; the next answer is the second read.
 */
describe('a claim that lost the row between its check and its write (rulings 581-583)', () => {
  const CHECK = 'id, email, claimed_by_user_id, events(slug)';
  const AIM = 'claimed_by_user_id.is.null,claimed_by_user_id.eq.user-lea';
  const row = (over: Record<string, unknown>) => ({
    data: { ...unclaimed(ROW).data, ...over },
    error: null,
  });
  const TAKEN = row({ claim_status: 'claimed', claimed_by_user_id: 'user-tom' });

  it('"this is me" does not count it, and its write aims at the row the check passed', async () => {
    const { service, db } = build([unclaimed(ROW), LOST, TAKEN]);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      await expect(service.claimPersons(signedIn, [ROW])).resolves.toEqual({
        claimed: 0,
        alreadyAtEvent: 0,
      });
      // The page counts nothing; the log says why.
      expect(warn).toHaveBeenCalledWith(`claim of person ${ROW} lost: held_by_another`);
    } finally {
      warn.mockRestore();
    }
    // The write asks for its rows back: without that the answer carries none, and every claim
    // would read as lost. The double answers rows either way, so the projection is named.
    expect(selectsFor(db.from, 'persons')).toEqual([CHECK, 'id', CHECK]);
    expect(filtersFor(db.from, 'persons', 'or')).toEqual([[AIM]]);
    // The check, the write (by id AND the address the check read), the second read.
    expect(filtersFor(db.from, 'persons', 'eq')).toEqual([
      ['id', ROW],
      ['id', ROW],
      ['email', LEA.email],
      ['id', ROW],
    ]);
  });

  // The Google claim goes through the same `claimFromLink`, so these cover both.
  const linkReason = async (secondRead: ChainResult) => {
    const { service, db, reply } = build([unclaimed(ROW), LOST, secondRead, NO_ROWS]);
    await service.handleCallback('token-hash', 'claim', ROW, undefined, reply as never);
    // The sign-in autolink reads after the claim: only the first three reads are the claim's.
    expect(selectsFor(db.from, 'persons').slice(0, 3)).toEqual([CHECK, 'id', CHECK]);
    const target = String(reply.redirect.mock.calls[0]?.[0]);
    const next = decodeURIComponent(target.split('next=')[1] ?? '');
    return new URLSearchParams(next.split('?')[1]).get('claimRefused');
  };

  it('the emailed link names each reason the second read finds (ruling 583)', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      await expect(linkReason(TAKEN)).resolves.toBe('held_by_another');
      await expect(linkReason(row({ email: 'tom@example.com' }))).resolves.toBe('email_mismatch');
      await expect(linkReason({ data: null, error: null })).resolves.toBe('not_found');
    } finally {
      warn.mockRestore();
    }
  });

  // The row changed and changed back (or only its address's case): nothing was decided.
  it('a second read that finds nothing wrong says "could not check", and the log says so', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      await expect(linkReason(unclaimed(ROW))).resolves.toBe('check_failed');
      expect(warn).toHaveBeenCalledWith(`claim of person ${ROW} lost: check_failed`);
    } finally {
      warn.mockRestore();
    }
  });

  // A second read that fails is a failed write: never "0 claimed", never a reason it did not read.
  it('a second read that fails throws, at "this is me" and at the link', async () => {
    const thisIsMe = build([unclaimed(ROW), LOST, FAULT]);
    await expect(thisIsMe.service.claimPersons(signedIn, [ROW])).rejects.toThrow(
      `Could not read person ${ROW} after a lost claim: connection refused`,
    );
    const link = build([unclaimed(ROW), LOST, FAULT, NO_ROWS]);
    const landed = link.service.handleCallback(
      'token-hash',
      'claim',
      ROW,
      undefined,
      link.reply as never,
    );
    await expect(landed).rejects.toThrow('connection refused');
    expect(link.reply.redirect).not.toHaveBeenCalled();
  });

  // The write requires the address as the check READ it, never the account's own spelling: a row
  // stored with capitals would otherwise miss every time and say "try again" forever.
  it('aims at the address as stored, not as the account spells it', async () => {
    const stored = ' Lea@Example.COM';
    const { service, db } = build([row({ email: stored }), OK, NO_PROFILE]);
    await expect(service.claimPersons(signedIn, [ROW])).resolves.toEqual({
      claimed: 1,
      alreadyAtEvent: 0,
    });
    expect(filtersFor(db.from, 'persons', 'eq')).toContainEqual(['email', stored]);
  });
});

/**
 * The Google claim is the mailed link's twin (operator ruling 307). A refusal threw: Lea read
 * "the server rejected the sign-in (HTTP 409)" and was signed out. Google has proven her account
 * by then, so she is signed in and sent to the claim page of the row's Event with the reason.
 */
describe('the Google claim (rulings 300, 307)', () => {
  const claim = (service: AuthService, reply: object) =>
    service.acceptOAuthSession(
      { accessToken: 'access', refreshToken: 'refresh', mode: 'person_claim', personId: ROW },
      reply as never,
    );

  it('signs her in and answers the claim page with the reason', async () => {
    const { service, reply } = build([unclaimed(ROW), SECOND_ROW_AT_EVENT, NO_ROWS]);

    await claim(service, reply);

    expect(reply.setCookie.mock.calls.map(([name]) => name)).toEqual([
      'sb-access-token',
      'sb-refresh-token',
    ]);
    expect(reply.send.mock.calls).toEqual([
      [{ next: `/e/spring-open/claim?personId=${ROW}&claimRefused=already_at_event` }],
    ]);
  });

  it('fails on any other failed write, with no cookie and no answer', async () => {
    const { service, reply } = build([unclaimed(ROW), FAULT, NO_ROWS]);

    await expect(claim(service, reply)).rejects.toThrow('connection refused');
    expect(reply.setCookie).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });
});
