import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';
import { MeController } from './me.controller';

/**
 * The login an account keeps after its password is written (operator ruling 352).
 *
 * Paul changes his password on the security page. The page says "Password updated". The auth
 * server ends EVERY session of an account whose password an admin call writes, the one Paul
 * is using too (read on GoTrue v2.195.0: `/user` answers 403 `session_not_found`, the refresh
 * 400). His next page that checks the account sent him to the sign-in screen, and the reset
 * door handed him the cookies of a session that was already gone. Both doors sign the account
 * in again with the password they just wrote. With no login of that account from the
 * sign-in, the browser's login is cleared: it is ended, or it is another account's.
 */
const PAUL = { id: 'user-paul', email: 'paul@example.com', identities: [{ provider: 'email' }] };
const NEW_PASSWORD = 'A-much-Longer-passw0rd!';

const config = {
  getOrThrow: vi.fn(() => 'http://supabase-auth:9999'),
  get: vi.fn((key: string, def?: string) => (key === 'DOMAIN' ? 'myclash.localhost' : (def ?? ''))),
};

type Answer = { ok: boolean; status: number; json: () => Promise<unknown> };
const answer = (status: number, body: object): Answer => ({
  ok: status < 400,
  status,
  json: async () => body,
});
const freshLogin = () =>
  answer(200, { access_token: 'fresh-access', refresh_token: 'fresh-refresh', user: PAUL });

function build(passwordDoor: (Answer | Error)[], resetUser: { id: string; email?: string } = PAUL) {
  const steps: string[] = [];
  const sent: unknown[] = [];
  const fetched = vi.fn(async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    steps.push(`password door: ${(JSON.parse(init.body) as { password: string }).password}`);
    const next = passwordDoor.shift();
    if (!next) throw new Error('the test queued no answer for this call');
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal('fetch', fetched);
  const updateUserById = vi.fn(async () => {
    steps.push('password written');
    return { error: null };
  });
  const verifyOtp = vi.fn().mockResolvedValue({
    data: {
      user: resetUser,
      session: { access_token: 'dead-access', refresh_token: 'dead-refresh', expires_in: 3600 },
    },
    error: null,
  });
  const supabase = {
    getAuthUser: vi.fn().mockResolvedValue(PAUL),
    anon: { auth: { verifyOtp } },
    service: { auth: { admin: { updateUserById } } },
  };
  const service = new AuthService(
    supabase as never,
    { sendMagicLink: vi.fn() } as never,
    config as never,
    {} as never,
    {} as unknown as LegalAcceptanceService,
    {} as never,
  );
  vi.spyOn(service, 'tryAutolinkGlobalPerson').mockResolvedValue(undefined);
  const warned = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const reply = { setCookie: vi.fn(), clearCookie: vi.fn(), send: vi.fn() };
  const signedIn = { headers: { authorization: 'Bearer access' } } as never;
  const cookies = () =>
    reply.setCookie.mock.calls.map(([name, value]) => [name, value] as [string, string]);
  const cleared = () => reply.clearCookie.mock.calls.map(([name]) => name as string);
  return { service, reply, signedIn, steps, cookies, cleared, warned, sent };
}

const BOTH_COOKIES = ['sb-access-token', 'sb-refresh-token'];
const FRESH_COOKIES = [
  ['sb-access-token', 'fresh-access'],
  ['sb-refresh-token', 'fresh-refresh'],
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a password change keeps its caller signed in (ruling 352)', () => {
  const current = () => answer(200, { access_token: 'old-access', user: PAUL });
  const change = (built: ReturnType<typeof build>) =>
    new MeController(built.service).changePassword(
      built.signedIn,
      { currentPassword: 'old-password', newPassword: NEW_PASSWORD },
      built.reply as never,
    );

  // Without `passthrough` Nest waits for the handler to send the reply: the request hangs.
  it('takes the reply at the route and still answers through Nest', () => {
    const route = readFileSync(join(__dirname, 'me.controller.ts'), 'utf8');
    expect(route).toMatch(
      /@Body\(\) dto: ChangePasswordDto,\s+@Res\(\{ passthrough: true \}\) reply: FastifyReply,/,
    );
  });

  it('signs the account in with the new password, after the write, and hands that login', async () => {
    const built = build([current(), freshLogin()]);

    expect(await change(built)).toEqual({ ok: true });

    expect(built.steps).toEqual([
      'password door: old-password',
      'password written',
      `password door: ${NEW_PASSWORD}`,
    ]);
    expect(built.sent.at(-1)).toEqual({
      email: PAUL.email,
      password: NEW_PASSWORD,
    });
    expect(built.cookies()).toEqual(FRESH_COOKIES);
    expect(built.reply.clearCookie).not.toHaveBeenCalled();
    expect(built.warned).not.toHaveBeenCalled();
  });

  it.each<[string, Answer | Error]>([
    ['is silent', new Error('connect ECONNREFUSED')],
    ['is throttled', answer(429, { error: 'x' })],
    ['refuses the sign-in', answer(400, { error_code: 'invalid_credentials' })],
    ['answers with no login', answer(200, { user: PAUL })],
    ['answers with no refresh token', answer(200, { access_token: 'fresh-access', user: PAUL })],
    ['answers with no access token', answer(200, { refresh_token: 'fresh-refresh', user: PAUL })],
    [
      'hands the login of another account',
      answer(200, { access_token: 'a', refresh_token: 'r', user: { id: 'user-other' } }),
    ],
  ])(
    'still answers ok when the auth server %s: the login is cleared, with a warning',
    async (_w, second) => {
      const built = build([current(), second]);

      expect(await change(built)).toEqual({ ok: true });

      expect(built.steps).toContain('password written');
      expect(built.reply.setCookie).not.toHaveBeenCalled();
      expect(built.cleared()).toEqual(BOTH_COOKIES);
      expect(built.warned).toHaveBeenCalledOnce();
      expect(built.warned).toHaveBeenCalledWith(expect.stringContaining(PAUL.id));
    },
  );
});

describe('a password reset signs its reader in (ruling 352)', () => {
  const reset = (built: ReturnType<typeof build>) =>
    built.service.publicPasswordResetConfirm('token-hash-0001', NEW_PASSWORD, built.reply as never);

  it('hands the login of the new password, never the one the write ended', async () => {
    const built = build([freshLogin()]);

    await reset(built);

    expect(built.steps).toEqual(['password written', `password door: ${NEW_PASSWORD}`]);
    expect(built.sent.at(-1)).toEqual({
      email: PAUL.email,
      password: NEW_PASSWORD,
    });
    expect(built.cookies()).toEqual(FRESH_COOKIES);
    expect(built.reply.send).toHaveBeenCalledWith({ next: '/me' });
  });

  // Ann is signed in on this browser and opens Paul's reset link: she must not stay signed
  // in as herself under "password reset", and Paul's ended session must not be handed out.
  it.each<[string, (Answer | Error)[], { id: string; email?: string }]>([
    ['the auth server gives no login', [answer(503, { error: 'x' })], PAUL],
    ['the account has no address', [], { id: PAUL.id }],
  ])('clears the login of the browser when %s, and still answers', async (_w, door, user) => {
    const built = build(door, user);

    await reset(built);

    expect(built.steps[0]).toBe('password written');
    expect(built.reply.setCookie).not.toHaveBeenCalled();
    expect(built.cleared()).toEqual(BOTH_COOKIES);
    expect(built.warned).toHaveBeenCalledOnce();
    expect(built.warned).toHaveBeenCalledWith(expect.stringContaining(PAUL.id));
    // The password door is asked only for an account with an address.
    expect(built.steps).toHaveLength(user.email ? 2 : 1);
    expect(built.reply.send).toHaveBeenCalledWith({ next: '/me' });
  });
});
