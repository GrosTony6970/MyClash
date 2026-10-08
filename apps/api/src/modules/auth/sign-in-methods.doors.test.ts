/**
 * Ruling 349: while the auth server gives no answer, nobody is told how an account signs in.
 *
 * Saturday 10:00, the auth server answers "too many requests". Somebody holds Marie's session.
 * Marie signs in with a password. `getAuthUser` then hands back the claims of her login, and
 * they carry no list of sign-in methods. The two doors read "no list" as "no password": the
 * security page drew her account as a Google one, and the account deletion erased her data on
 * the typed word alone. "Not known" is a server error now, and nothing is erased.
 *
 * Each case enters at the controller with a REAL `SupabaseService` over a stubbed `fetch`.
 * A real auth server (GoTrue v2.195.0) answers a list for every account, an empty one for an
 * account with no identity: the "no list" answer below is a shape it does not send today.
 */
import { BadRequestException, HttpException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthService } from './auth.service';
import { MeController } from './me.controller';

const SECRET = 'test-supabase-jwt-secret-at-least-32-characters-long';
const MARIE = '11111111-1111-4111-8111-111111111111';
const EMAIL = 'marie@example.com';

const values: Record<string, string> = {
  SUPABASE_URL: 'https://app.myclash.fr',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUPABASE_JWT_SECRET: SECRET,
  SUPABASE_AUTH_INTERNAL_URL: 'http://supabase-auth:9999',
  DOMAIN: 'myclash.localhost',
};
const config = {
  get: (key: string, otherwise = '') => values[key] ?? otherwise,
  getOrThrow: (key: string) => values[key],
};

function enter() {
  const supabase = new SupabaseService(config as never);
  const deleteUser = vi
    .spyOn(supabase.service.auth.admin, 'deleteUser')
    .mockResolvedValue({ data: { user: null }, error: null } as never);
  const erasure = { redactSubject: vi.fn(async () => ({})), recordErasure: vi.fn() };
  const auth = new AuthService(
    supabase,
    {} as never,
    config as never,
    erasure as never,
    {} as never,
    {} as never,
  );
  const token = jwt.sign({ sub: MARIE, email: EMAIL }, SECRET, { expiresIn: '1h' });
  const req = { headers: { authorization: `Bearer ${token}` }, cookies: {} } as never;
  const reply = { clearCookie: vi.fn(), send: vi.fn() };
  const me = new MeController(auth);
  return {
    erasure,
    deleteUser,
    reply,
    status: () => me.getSecurityStatus(req),
    deletion: (confirmation = 'DELETE') =>
      me.deleteAccount(req, { currentPassword: '', confirmation } as never, reply as never),
  };
}

const authServerAnswers = (answer: () => Promise<Response>) =>
  vi.stubGlobal('fetch', vi.fn(answer));
const lists = (identities: unknown) => async () =>
  new Response(JSON.stringify({ id: MARIE, email: EMAIL, identities }), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const NOT_KNOWN = 'The auth server did not answer how this account signs in';

const SILENCES: Array<[string, () => Promise<Response>]> = [
  ['gives no answer', () => Promise.reject(new Error('ECONNREFUSED'))],
  ['answers "too many requests"', async () => new Response('{}', { status: 429 })],
  ['answers a server error', async () => new Response('{}', { status: 503 })],
  ['answers an account with no list of sign-in methods', lists(null)],
];

describe.each(SILENCES)('an auth server that %s', (_silence, answer) => {
  it('the security status is a server error, never "no password"', async () => {
    authServerAnswers(answer);

    const failure = await enter()
      .status()
      .catch((thrown: unknown) => thrown);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect((failure as Error).message).toBe(NOT_KNOWN);
  });

  it('the account deletion is a server error, and nothing is erased', async () => {
    authServerAnswers(answer);
    const door = enter();

    const failure = await door.deletion().catch((thrown: unknown) => thrown);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect((failure as Error).message).toBe(NOT_KNOWN);
    expect(door.erasure.redactSubject).not.toHaveBeenCalled();
    expect(door.deleteUser).not.toHaveBeenCalled();
    expect(door.reply.send).not.toHaveBeenCalled();
  });

  it('a wrong confirmation word is still said first', async () => {
    authServerAnswers(answer);

    await expect(enter().deletion('delete')).rejects.toThrow(BadRequestException);
  });
});

describe('an auth server that answers', () => {
  it.each([
    ['a password', [{ provider: 'email' }], true],
    ['a password and Google', [{ provider: 'google' }, { provider: 'email' }], true],
    ['Google alone', [{ provider: 'google' }], false],
    ['no sign-in method', [], false],
  ])('the security status of an account with %s', async (_what, identities, hasPassword) => {
    authServerAnswers(lists(identities));

    expect(await enter().status()).toEqual({ hasPassword, email: EMAIL });
  });

  it('deletes a Google account on the typed word alone', async () => {
    authServerAnswers(lists([{ provider: 'google' }]));
    const door = enter();

    await door.deletion();

    expect(door.erasure.redactSubject).toHaveBeenCalledWith(MARIE);
    expect(door.deleteUser).toHaveBeenCalledWith(MARIE);
    expect(door.reply.send).toHaveBeenCalledWith({ ok: true, next: '/?account_deleted=1' });
  });
});
