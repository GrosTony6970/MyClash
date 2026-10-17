import { Logger, type HttpException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LINK_EXPIRED_CODE, LINK_UNCHECKED_CODE } from '@myclash/types';
import type { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * The page a sign-up's mail opens: "choose your password" (ruling "Pre-takeover", 2026-10-16).
 *
 * Léa opens the mail and types a password. ONE request checks it, spends the link's code,
 * writes the password for the account the CODE names, and signs her in with it. A weak
 * password leaves the link unspent. A write the auth server refused, or never judged, leaves
 * her signed in by the code's session, so the page can offer "Set a password".
 */
const LEA = { id: 'user-lea', email: 'lea@example.com' };
const CHOSEN = 'A-much-Longer-passw0rd!';
const SPEND = {
  access_token: 'spend-access',
  refresh_token: 'spend-refresh',
  expires_in: 3600,
  user: LEA,
};

type Write = () => Promise<unknown>;
type Opts = { code?: () => Promise<unknown>; write?: Write; signIn?: () => Promise<unknown> };

const FRESH_LOGIN = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', user: LEA }),
});

/** The limit clocks of the auth server's calls; `timeIsUp` runs out the newest one. */
function limitClocks() {
  const clocks: AbortController[] = [];
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
    clocks.push(new AbortController());
    return clocks.at(-1)!.signal;
  });
  return async (asked: ReturnType<typeof vi.fn>) => {
    await vi.waitFor(() => expect(asked).toHaveBeenCalled());
    clocks.at(-1)!.abort();
  };
}

/** The password sign-in after the write (`askPasswordToken`), recorded in `steps`. */
function stubPasswordSignIn(steps: string[], signIn: () => Promise<unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      steps.push(`sign-in: ${(JSON.parse(init.body) as { password: string }).password}`);
      return signIn();
    }),
  );
}

function build(opts: Opts = {}) {
  const steps: string[] = [];
  const timeIsUp = limitClocks();
  stubPasswordSignIn(steps, opts.signIn ?? FRESH_LOGIN);
  const verifyOtp = vi.fn(async (...args: unknown[]) => {
    steps.push(`spend: ${JSON.stringify(args[0])}`);
    return opts.code ? opts.code() : { data: { user: LEA, session: SPEND }, error: null };
  });
  const updateUserById = vi.fn(async (userId: string, attrs: { password: string }) => {
    steps.push(`write ${userId}: ${attrs.password}`);
    return opts.write ? opts.write() : { error: null };
  });
  const supabase = {
    anon: { auth: { verifyOtp } },
    service: { auth: { admin: { updateUserById } } },
  };
  const service = new AuthService(
    supabase as never,
    { sendMagicLink: vi.fn() } as never,
    {
      getOrThrow: vi.fn(() => 'http://supabase-auth:9999'),
      get: vi.fn((key: string, def?: string) => (key === 'DOMAIN' ? 'myclash.fr' : (def ?? ''))),
    } as never,
    {} as never,
    {} as unknown as LegalAcceptanceService,
    {} as never,
  );
  vi.spyOn(service, 'tryAutolinkGlobalPerson').mockImplementation(async (userId) => {
    steps.push(`profile link ${userId}`);
  });
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const reply = { setCookie: vi.fn(), clearCookie: vi.fn(), send: vi.fn() };
  const choose = (password = CHOSEN, next: string | undefined = '/e/fal-2026') =>
    new AuthController(service).publicChoosePassword(
      { token_hash: 'c0de-from-the-mail', password, next },
      reply as never,
    );
  const cookies = () =>
    reply.setCookie.mock.calls.map(([name, value]) => [name, value] as [string, string]);
  return { choose, reply, steps, cookies, verifyOtp, updateUserById, timeIsUp };
}

const SPEND_COOKIES = [
  ['sb-access-token', 'spend-access'],
  ['sb-refresh-token', 'spend-refresh'],
];
const SPEND_STEPS = [
  `spend: ${JSON.stringify({ token_hash: 'c0de-from-the-mail', type: 'email' })}`,
  'profile link user-lea',
  `write user-lea: ${CHOSEN}`,
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('choose your password, from the sign-up mail', () => {
  it('spends the code, links the profile, writes for the code’s account, then signs in with it', async () => {
    const built = build();

    await built.choose();

    expect(built.steps).toEqual([...SPEND_STEPS, `sign-in: ${CHOSEN}`]);
    // Only the new password's login: the write ended the code's session.
    expect(built.cookies()).toEqual([
      ['sb-access-token', 'fresh-access'],
      ['sb-refresh-token', 'fresh-refresh'],
    ]);
    expect(built.reply.send).toHaveBeenCalledWith({
      saved: true,
      signedIn: true,
      next: '/e/fal-2026',
    });
  });

  it('opens the home page when the page it was given is not one of ours', async () => {
    const built = build();

    await built.choose(CHOSEN, 'https://evil.example/');

    expect(built.reply.send).toHaveBeenCalledWith(expect.objectContaining({ next: '/' }));
  });

  it('refuses a weak password before the code is spent: the link still works', async () => {
    const built = build();

    const refusal = await built.choose('short').catch((err: unknown) => err);

    expect((refusal as HttpException).getStatus()).toBe(400);
    expect((refusal as HttpException).getResponse()).toMatchObject({ code: 'weak_password' });
    expect(built.verifyOtp).not.toHaveBeenCalled();
    expect(built.updateUserById).not.toHaveBeenCalled();
  });

  it('answers 401 link_expired for a code the auth server refused, and writes nothing', async () => {
    const built = build({
      code: async () => ({ data: {}, error: { status: 403, message: 'expired' } }),
    });

    const refusal = await built.choose().catch((err: unknown) => err);

    expect((refusal as HttpException).getStatus()).toBe(401);
    expect((refusal as HttpException).getResponse()).toMatchObject({ code: LINK_EXPIRED_CODE });
    expect(built.updateUserById).not.toHaveBeenCalled();
    expect(built.reply.setCookie).not.toHaveBeenCalled();
  });

  it('answers link_unchecked for a code nobody judged, and writes nothing', async () => {
    const built = build({
      code: async () => ({ data: {}, error: { status: 429, message: 'too many' } }),
    });

    await built.choose();

    expect(built.reply.send).toHaveBeenCalledWith({ code: LINK_UNCHECKED_CODE });
    expect(built.updateUserById).not.toHaveBeenCalled();
    expect(built.reply.setCookie).not.toHaveBeenCalled();
  });

  it('keeps her signed in by the code’s session when the auth server refuses the write', async () => {
    const built = build({ write: async () => ({ error: { status: 422, message: 'refused' } }) });

    await built.choose();

    expect(built.steps).toEqual(SPEND_STEPS);
    expect(built.cookies()).toEqual(SPEND_COOKIES);
    expect(built.reply.send).toHaveBeenCalledWith({
      saved: false,
      signedIn: true,
      next: '/e/fal-2026',
    });
  });

  it.each<[string, Write]>([
    ['throttles the write', async () => ({ error: { status: 429, message: 'x' } })],
    ['fails on the write', async () => ({ error: { status: 503, message: 'x' } })],
    ['answers the write with no status', async () => ({ error: { message: 'fetch failed' } })],
    // The code is spent by now: a 500 would leave a dead link and no login.
    [
      'throws on the write',
      async () => {
        throw new Error('unexpected');
      },
    ],
  ])('says "unknown" when the auth server %s: it may still land', async (_w, write) => {
    const built = build({ write });

    await built.choose();

    expect(built.steps).toEqual(SPEND_STEPS);
    expect(built.cookies()).toEqual(SPEND_COOKIES);
    expect(built.reply.send).toHaveBeenCalledWith(expect.objectContaining({ saved: 'unknown' }));
  });

  it('says "unknown" when the write gets no answer in time', async () => {
    const built = build({ write: () => new Promise<never>(() => undefined) });

    const answered = built.choose();
    await built.timeIsUp(built.updateUserById);
    await answered;

    expect(built.cookies()).toEqual(SPEND_COOKIES);
    expect(built.reply.send).toHaveBeenCalledWith({
      saved: 'unknown',
      signedIn: true,
      next: '/e/fal-2026',
    });
  });

  it('says the password is saved but she is not signed in when the new password’s sign-in fails', async () => {
    const built = build({
      signIn: async () => ({ ok: false, status: 503, json: async () => ({ error: 'x' }) }),
    });

    await built.choose();

    expect(built.steps).toEqual([...SPEND_STEPS, `sign-in: ${CHOSEN}`]);
    expect(built.reply.setCookie).not.toHaveBeenCalled();
    expect(built.reply.send).toHaveBeenCalledWith({
      saved: true,
      signedIn: false,
      next: '/e/fal-2026',
    });
  });
});
