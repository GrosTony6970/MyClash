/**
 * Ruling 347: read-only mode makes no account at the mailed-link door.
 *
 * Read-only mode is on. Léa has no account. She asks for a sign-in link: the auth server made
 * her account at that moment. She now gets no account and no mail, and reads what anybody
 * reads. Ann, who holds an account, gets her link as before (ruling 341).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase as seededSupabase } from '../../common/testing/supabase-chain';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthService } from './auth.service';
import { holdsAccount } from './read-only-link';

const SENT = { message: 'If this email is registered, a link has been sent.' };
const ROW = '11111111-1111-4111-8111-111111111111';
/** What a real auth server answered to `filter=lea_new@example.test`: `_` is any character. */
const LOOSE_MATCHES = [
  'alea_new@example.test',
  'lea_new@example.test',
  'lea_new@example.test.au',
  'leaxnew@example.test',
];

const generateLink = vi.fn();
const sendMagicLink = vi.fn();
const listAuthAdminUsers = vi.fn();

function door(readOnly: boolean) {
  const db = seededSupabase({
    feature_flags: { rows: [{ key: 'read_only_mode', enabled: readOnly }] },
    persons: { rows: [{ id: ROW, email: 'lea@example.com', claimed_by_user_id: null }] },
  });
  const supabase = {
    service: { from: db.service.from, auth: { admin: { generateLink } } },
    listAuthAdminUsers,
  };
  const config = { get: (_key: string, otherwise?: string) => otherwise ?? '' };
  return new AuthService(
    supabase as never,
    { sendMagicLink } as never,
    config as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

const accounts = (...emails: string[]) => ({
  ok: true,
  status: 200,
  detail: null,
  data: { users: emails.map((email, n) => ({ id: `user-${n}`, email })) },
});

beforeEach(() => {
  vi.clearAllMocks();
  generateLink.mockResolvedValue({
    data: { properties: { action_link: 'https://x.test/verify', hashed_token: 'c0de' } },
    error: null,
  });
});

describe('a sign-in link asked for during read-only mode (ruling 347)', () => {
  it('an address with no account gets no account and no mail, and the same answer', async () => {
    listAuthAdminUsers.mockResolvedValue(accounts('alea@example.com'));

    const answer = await door(true).requestMagicLink({
      email: 'lea@example.com',
      type: 'public_login',
    });

    expect(answer).toEqual(SENT);
    expect(generateLink).not.toHaveBeenCalled();
    expect(sendMagicLink).not.toHaveBeenCalled();
  });

  it('an address that holds an account gets its link', async () => {
    listAuthAdminUsers.mockResolvedValue(accounts('ann@example.com'));

    const answer = await door(true).requestMagicLink({ email: 'Ann@Example.com', type: 'login' });

    expect(answer).toEqual(SENT);
    expect(listAuthAdminUsers).toHaveBeenCalledWith(1, 50, 'ann@example.com');
    expect(generateLink).toHaveBeenCalledOnce();
    expect(sendMagicLink).toHaveBeenCalledOnce();
  });

  it('a claim link for an address with no account makes none either', async () => {
    listAuthAdminUsers.mockResolvedValue(accounts());

    await door(true).requestMagicLink({ email: 'lea@example.com', type: 'claim', personId: ROW });

    expect(generateLink).not.toHaveBeenCalled();
    expect(sendMagicLink).not.toHaveBeenCalled();
  });

  it('an auth server that does not say who holds the address makes no link', async () => {
    listAuthAdminUsers.mockResolvedValue({ ok: false, status: 0, detail: 'timeout', data: null });

    const answer = await door(true).requestMagicLink({ email: 'ann@example.com', type: 'login' });

    expect(answer).toEqual(SENT);
    expect(generateLink).not.toHaveBeenCalled();
  });
});

describe('a sign-in link asked for with read-only mode off', () => {
  it('an address with no account gets its account and its link, and nobody is looked up', async () => {
    await door(false).requestMagicLink({ email: 'lea@example.com', type: 'public_login' });

    expect(listAuthAdminUsers).not.toHaveBeenCalled();
    expect(generateLink).toHaveBeenCalledWith({ type: 'magiclink', email: 'lea@example.com' });
    expect(sendMagicLink).toHaveBeenCalledOnce();
  });
});

describe('who holds an address, asked of the auth server', () => {
  const values: Record<string, string> = {
    SUPABASE_URL: 'https://app.myclash.fr',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    SUPABASE_AUTH_INTERNAL_URL: 'http://supabase-auth:9999',
  };
  const config = { get: (key: string) => values[key], getOrThrow: (key: string) => values[key] };
  const fetched = vi.fn();
  const users = (emails: string[]) =>
    new Response(JSON.stringify({ users: emails.map((email) => ({ id: email, email })) }));
  const ask = (email: string) => holdsAccount(new SupabaseService(config as never), email);

  beforeEach(() => vi.stubGlobal('fetch', fetched));
  afterEach(() => vi.unstubAllGlobals());

  it('asks for the address in lower case, on the internal address', async () => {
    fetched.mockResolvedValue(users(LOOSE_MATCHES));

    await expect(ask(' Lea_New@Example.test ')).resolves.toBe(true);
    expect(fetched.mock.calls[0]![0]).toBe(
      'http://supabase-auth:9999/admin/users?page=1&per_page=50&filter=lea_new%40example.test',
    );
  });

  it('reads an address that only looks like the ones answered as held by nobody', async () => {
    fetched.mockResolvedValue(users(LOOSE_MATCHES.filter((email) => !email.startsWith('lea_'))));

    await expect(ask('lea_new@example.test')).resolves.toBe(false);
  });

  it.each([
    ['answers a server error', async () => new Response('{}', { status: 503 })],
    ['gives no answer', () => Promise.reject(new Error('ECONNREFUSED'))],
  ])('does not say when the auth server %s', async (_what, answer) => {
    fetched.mockImplementation(answer);

    await expect(ask('lea_new@example.test')).resolves.toBeNull();
  });
});
