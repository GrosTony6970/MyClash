import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CLAIM_LINK_REFUSALS } from '@myclash/types';
import type { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';
import {
  mockSupabase as seededSupabase,
  scopedTo,
  selectsFor,
  writesTo,
  type RecordedWrite,
  type TableSeed,
} from '../../common/testing/supabase-chain';

/**
 * The emailed-link claim, at the callback (`handleCallback` with `type=claim`).
 *
 * The roster row comes from the link's address, not from the sign-in code, so
 * anyone who signs in with a code for their OWN address could name any row
 * (ruling 46). The row must carry the account's email, and nobody else may hold
 * it — the Google claim's check; a row this same account already holds passes
 * (ruling 50).
 *
 * A refusal no longer throws after the cookies are set (ruling 57). The link has
 * signed her in, and a raw 400 left her signed in with nothing to click. She is
 * sent to the claim page of the row's Event with the reason instead, or to /me
 * when there is no row to name an Event by (ruling 59). A row that could not be
 * read has its own reason: nothing was decided (ruling 60).
 */
const verifyOtpMock = vi.fn();
const fromMock = vi.fn();

const supabase = {
  getAuthUser: vi.fn(),
  refreshSession: vi.fn(),
  service: { auth: { admin: { generateLink: vi.fn() } }, from: fromMock },
  anon: { auth: { verifyOtp: verifyOtpMock } },
};

const config = {
  getOrThrow: vi.fn(),
  get: vi.fn((key: string, def?: string) => (key === 'DOMAIN' ? 'myclash.localhost' : (def ?? ''))),
};

function seedTables(byTable: Record<string, TableSeed>) {
  const seeded = seededSupabase(byTable);
  fromMock.mockImplementation(seeded.from as never);
  return seeded;
}

/** The id list an `in('col', [...])` scoped a write to — `scopedTo` sees only `eq`. */
const inScoped = (write: RecordedWrite | undefined, column: string): unknown[] =>
  (write?.filters ?? []).find((filter) => filter.method === 'in' && filter.args[0] === column)
    ?.args[1] as unknown[];

function makeReply() {
  return { setCookie: vi.fn(), clearCookie: vi.fn(), send: vi.fn(), redirect: vi.fn() };
}

describe('AuthService.handleCallback — claim', () => {
  const USER = 'user-1';
  const EMAIL = 'fighter@example.com';
  const ROW = '00000000-0000-0000-0000-000000000001';
  const APP = 'https://app.myclash.localhost';
  const NEIGHBOUR = {
    id: '00000000-0000-0000-0000-0000000000ff',
    email: EMAIL,
    claim_status: 'unclaimed',
    claimed_by_user_id: null,
    global_person_id: null,
    events: { slug: 'other-open' },
  };
  const claimPage = (reason: string) =>
    `${APP}/e/spring-open/claim?personId=${ROW}&claimRefused=${reason}`;

  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockImplementation((table: string) => {
      throw new Error(`claim-link test: query against unseeded table "${table}"`);
    });
    verifyOtpMock.mockReset();
    service = new AuthService(
      supabase as never,
      { sendMagicLink: vi.fn() } as never,
      config as never,
      {} as never,
      {} as LegalAcceptanceService,
    );
  });

  const signedInAs = (email: string | undefined) =>
    verifyOtpMock.mockResolvedValue({
      data: {
        session: {
          access_token: 'access',
          refresh_token: 'refresh',
          expires_in: 3600,
          user: { id: USER, email },
        },
      },
      error: null,
    });

  // A neighbour carries the account's email too, so a read keyed by email
  // instead of id finds two rows and cannot decide.
  const withRow = (row: Record<string, unknown>) =>
    seedTables({
      persons: {
        rows: [
          NEIGHBOUR,
          { id: ROW, global_person_id: null, events: { slug: 'spring-open' }, ...row },
        ],
      },
      global_persons: { rows: [] },
    });

  const callback = (reply = makeReply(), next?: string) =>
    service.handleCallback('token-hash', 'claim', ROW, next, reply as never);

  /** Signed in: both cookies set, whatever the claim's outcome. */
  const signedIn = (reply: ReturnType<typeof makeReply>) =>
    reply.setCookie.mock.calls.map(([name]) => name as string);

  it('claims the row named in the link when it carries the account’s email', async () => {
    signedInAs(EMAIL);
    const seeded = withRow({ email: EMAIL, claim_status: 'unclaimed', claimed_by_user_id: null });
    const reply = makeReply();

    await callback(reply);

    const [claim] = writesTo(seeded, 'persons');
    expect(claim?.row).toEqual({ claim_status: 'claimed', claimed_by_user_id: USER });
    expect(scopedTo(claim, 'id')).toBe(ROW);
  });

  // Where a successful claim lands is unchanged by ruling 57: the `next` the
  // link carries, on the app domain, and the app's home when it carries none.
  it.each([
    [undefined, `${APP}/`],
    ['/e/spring-open', `${APP}/e/spring-open`],
  ])('sends a successful claim with next=%s where it went before: %s', async (next, url) => {
    signedInAs(EMAIL);
    withRow({ email: EMAIL, claim_status: 'unclaimed', claimed_by_user_id: null });
    const reply = makeReply();

    await callback(reply, next);

    expect(reply.redirect).toHaveBeenCalledWith(url);
  });

  it.each([
    [
      'a row with another person’s email',
      EMAIL,
      { email: 'anna@example.com', claim_status: 'unclaimed', claimed_by_user_id: null },
      claimPage('email_mismatch'),
    ],
    [
      'a row someone already claimed',
      EMAIL,
      { email: EMAIL, claim_status: 'claimed', claimed_by_user_id: 'other-user' },
      claimPage('held_by_another'),
    ],
    // The holder decides, not the status column: `completeClaim` writes scoped
    // by id alone, so a row whose holder is set while its status says otherwise
    // would be handed to the next asker. The /me door refuses that state too.
    [
      'a row another account holds while its status disagrees',
      EMAIL,
      { email: EMAIL, claim_status: 'unclaimed', claimed_by_user_id: 'other-user' },
      claimPage('held_by_another'),
    ],
    // A row with no email matches nobody. (The old loose check read it as a
    // TypeError, swallowed it and let the claim through.)
    [
      'a row with no email',
      EMAIL,
      { email: null, claim_status: 'unclaimed', claimed_by_user_id: null },
      claimPage('email_mismatch'),
    ],
    // An empty email on both sides is not a match.
    [
      'an account with no email',
      undefined,
      { email: '', claim_status: 'unclaimed', claimed_by_user_id: null },
      claimPage('email_mismatch'),
    ],
  ])(
    'refuses %s: signed in, sent to the claim page with the reason, nothing claimed',
    async (_label, accountEmail, row, url) => {
      signedInAs(accountEmail);
      const seeded = withRow(row);
      const reply = makeReply();

      await callback(reply);

      expect(signedIn(reply)).toEqual(['sb-access-token', 'sb-refresh-token']);
      expect(reply.redirect).toHaveBeenCalledWith(url);
      expect(writesTo(seeded, 'persons')).toEqual([]);
    },
  );

  // No row, so no Event whose claim page could be named (ruling 59).
  it('sends a link for a row that does not exist to /me with the reason', async () => {
    signedInAs(EMAIL);
    const seeded = seedTables({ persons: { rows: [NEIGHBOUR] }, global_persons: { rows: [] } });
    const reply = makeReply();

    await callback(reply);

    expect(signedIn(reply)).toEqual(['sb-access-token', 'sb-refresh-token']);
    expect(reply.redirect).toHaveBeenCalledWith(`${APP}/me?claimRefused=not_found`);
    expect(writesTo(seeded, 'persons')).toEqual([]);
  });

  // A failed read is not a verdict about the row (ruling 60).
  it('sends a link whose row cannot be read to /me with its own reason', async () => {
    signedInAs(EMAIL);
    const seeded = seedTables({
      persons: { data: null, error: { message: 'statement timeout' } },
      global_persons: { rows: [] },
    });
    const reply = makeReply();

    await callback(reply);

    expect(reply.redirect).toHaveBeenCalledWith(`${APP}/me?claimRefused=check_failed`);
    expect(writesTo(seeded, 'persons')).toEqual([]);
  });

  // The page says a different sentence for each, so each must arrive as its own
  // value — and every value the page knows must be one the API can send.
  it('tells the four refusals apart', async () => {
    const reasons = new Set<string>();
    const refuse = async (seed: Record<string, TableSeed>) => {
      signedInAs(EMAIL);
      seedTables(seed);
      const reply = makeReply();
      await callback(reply);
      const url = new URL(reply.redirect.mock.calls[0]?.[0] as string);
      reasons.add(url.searchParams.get('claimRefused') ?? '');
    };
    const row = (fields: Record<string, unknown>) => ({
      persons: { rows: [{ id: ROW, events: { slug: 'spring-open' }, ...fields }] },
      global_persons: { rows: [] },
    });

    await refuse(row({ email: EMAIL, claim_status: 'claimed', claimed_by_user_id: 'other-user' }));
    await refuse(row({ email: 'anna@example.com', claim_status: 'unclaimed' }));
    await refuse({ persons: { rows: [] }, global_persons: { rows: [] } });
    await refuse({
      persons: { data: null, error: { message: 'boom' } },
      global_persons: { rows: [] },
    });

    expect([...reasons].sort()).toEqual([...CLAIM_LINK_REFUSALS].sort());
  });

  // The two doors that still answer with an error keep the class and message
  // each refusal had before the check was shared with the callback.
  it.each([
    [
      'unreadable',
      { data: null, error: { message: 'timeout' } },
      'Could not validate profile',
      400,
    ],
    ['missing', { rows: [] }, 'Person not found', 404],
    ['mismatched', { rows: [{ id: ROW, email: 'anna@example.com' }] }, 'Email does not match', 400],
  ])('the link request refuses a %s row with its old error', async (_l, persons, text, status) => {
    seedTables({ persons });
    const call = service.requestMagicLink({ email: EMAIL, type: 'claim', personId: ROW });
    await expect(call).rejects.toThrow(text);
    expect(await call.catch((e: { getStatus(): number }) => e.getStatus())).toBe(status);
  });

  it('the Google claim answers a row another account holds with its old error', async () => {
    supabase.getAuthUser.mockResolvedValue({ id: USER, email: EMAIL });
    withRow({ email: EMAIL, claim_status: 'claimed', claimed_by_user_id: 'other-user' });
    const call = service.acceptOAuthSession(
      { accessToken: 'token', mode: 'person_claim', personId: ROW } as never,
      makeReply() as never,
    );
    await expect(call).rejects.toThrow('This profile has already been claimed');
    expect(await call.catch((e: { getStatus(): number }) => e.getStatus())).toBe(400);
  });

  /**
   * Operator ruling 50: a row this very account already holds is not an error.
   *
   * A fighter asks for a claim link, then signs in another way before the mail
   * arrives; the autolink flips the row to claimed. Clicking the link then met
   * a raw 400 "This profile has already been claimed" — about a row that is
   * hers. The claim is idempotent, so it simply runs again.
   */
  it('accepts a row this same account already claimed, and redirects', async () => {
    signedInAs(EMAIL);
    const seeded = withRow({ email: EMAIL, claim_status: 'claimed', claimed_by_user_id: USER });
    const reply = makeReply();

    await callback(reply);

    expect(scopedTo(writesTo(seeded, 'persons')[0], 'id')).toBe(ROW);
    expect(reply.redirect).toHaveBeenCalledWith(`${APP}/`);
    // The owner is read, or "already claimed by me" cannot be told from
    // "already claimed by someone else", and the Event's slug names the claim
    // page a refusal goes to — the double ignores projections.
    expect(selectsFor(seeded.from, 'persons')).toContain(
      'id, email, claim_status, claimed_by_user_id, events(slug)',
    );
  });

  /**
   * The re-claim is not a pure no-op: the global profile behind the row is
   * handed over on the way, which the old refusal never reached. It is the
   * same repair the sign-in autolink does, gated on the account's own
   * address (ruling 40), so it can only complete a claim, never take one.
   */
  it('hands over the profile behind a row it re-claims, when that profile is the account’s', async () => {
    signedInAs(EMAIL);
    const seeded = seedTables({
      persons: {
        rows: [
          NEIGHBOUR,
          {
            id: ROW,
            email: EMAIL,
            claim_status: 'claimed',
            claimed_by_user_id: USER,
            global_person_id: 'global-1',
            events: { slug: 'spring-open' },
          },
        ],
      },
      global_persons: {
        rows: [
          { id: 'global-other', email: 'someone.else@example.com', claimed_by_user_id: null },
          { id: 'global-1', email: EMAIL, claimed_by_user_id: null, merged_into_id: null },
        ],
      },
      fighter_clubs: { rows: [] },
    });

    await callback();

    const [link] = writesTo(seeded, 'global_persons');
    expect(link?.row).toMatchObject({ claimed_by_user_id: USER });
    expect(scopedTo(link, 'id')).toBe('global-1');
  });

  /**
   * A refused claim still runs the sign-in autolink. She is signed in as
   * herself — the link proved the address — so the profile carrying that
   * address is hers as on any other sign-in (ruling 47). The sweep behind it
   * claims only unclaimed rows carrying her address: the row another account
   * holds stays theirs.
   */
  it('still links the account’s own profile when the claim is refused, and leaves the held row alone', async () => {
    const OWN = '00000000-0000-0000-0000-000000000002';
    signedInAs(EMAIL);
    const seeded = seedTables({
      persons: {
        rows: [
          {
            id: ROW,
            email: EMAIL,
            claim_status: 'claimed',
            claimed_by_user_id: 'other-user',
            global_person_id: 'global-mine',
            events: { slug: 'spring-open' },
          },
          {
            id: OWN,
            email: EMAIL,
            claim_status: 'unclaimed',
            claimed_by_user_id: null,
            global_person_id: 'global-mine',
          },
        ],
      },
      global_persons: {
        rows: [{ id: 'global-mine', email: EMAIL, claimed_by_user_id: null, merged_into_id: null }],
      },
    });
    const reply = makeReply();

    await callback(reply);

    expect(reply.redirect).toHaveBeenCalledWith(claimPage('held_by_another'));
    const [link] = writesTo(seeded, 'global_persons');
    expect(scopedTo(link, 'id')).toBe('global-mine');
    const rowWrites = writesTo(seeded, 'persons');
    expect(rowWrites).toHaveLength(1);
    expect(inScoped(rowWrites[0], 'id')).toEqual([OWN]);
  });
});
