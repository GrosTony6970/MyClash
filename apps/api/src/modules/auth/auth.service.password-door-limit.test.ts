import { HttpException, Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';

/**
 * The auth server's password door is held to five seconds (operator ruling 357).
 *
 * Paul sets a new password. The API writes it, then asks the auth server for a fresh login,
 * and the auth server hangs. The API waited with no limit: Paul's page gave up at 15 seconds
 * and said "network error" over a password that HAD changed. Every call to that door stops
 * after five seconds now, the limit of the API's other calls to the auth server. A sign-in
 * screen reads a server error then, and a door that already wrote the password still answers.
 */
const PAUL = { id: 'user-paul', email: 'paul@example.com', identities: [{ provider: 'email' }] };
const NEW_PASSWORD = 'A-much-Longer-passw0rd!';

const config = {
  getOrThrow: vi.fn(() => 'http://supabase-auth:9999'),
  get: vi.fn((key: string, def?: string) => (key === 'DOMAIN' ? 'myclash.localhost' : (def ?? ''))),
};

type Call = { signal?: AbortSignal };
const current = () => ({
  ok: true,
  status: 200,
  json: async () => ({ access_token: 'old-access', user: PAUL }),
});

/**
 * An auth server that answers `answered` calls, then never answers: only its limit ends a
 * call. With `stalls: 'body'` it sends the head of its answer and never the rest.
 */
function build(answered: number, stalls: 'head' | 'body' = 'head') {
  const limits: number[] = [];
  const clocks: AbortController[] = [];
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    limits.push(ms);
    clocks.push(new AbortController());
    return clocks.at(-1)!.signal;
  });
  let calls = 0;
  const fetched = vi.fn((_url: string, init: Call) => {
    calls += 1;
    if (calls <= answered) return Promise.resolve(current());
    const untilTheLimit = () =>
      new Promise((_resolve, reject) => {
        if (!init.signal) return; // No limit: this call hangs for ever, and so does the test.
        init.signal.addEventListener('abort', () => reject(new Error('The operation timed out')));
      });
    if (stalls === 'body') return Promise.resolve({ ...current(), json: untilTheLimit });
    return untilTheLimit();
  });
  vi.stubGlobal('fetch', fetched);
  const updateUserById = vi.fn(async () => ({ error: null }));
  const supabase = {
    getAuthUser: vi.fn().mockResolvedValue(PAUL),
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
  const warned = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const reply = { setCookie: vi.fn(), clearCookie: vi.fn(), send: vi.fn() };
  const change = () =>
    service.changePassword(
      { headers: { authorization: 'Bearer access' } } as never,
      'old-password',
      NEW_PASSWORD,
      reply as never,
    );
  /** The limit of the newest call runs out. */
  const timeIsUp = async () => {
    await vi.waitFor(() => expect(fetched).toHaveBeenCalledTimes(answered + 1));
    clocks.at(-1)!.abort();
  };
  return { change, timeIsUp, limits, fetched, updateUserById, reply, warned };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the password door of the auth server is held to five seconds (ruling 357)', () => {
  it('ends a check of the current password as a server error, and writes nothing', async () => {
    const built = build(0);

    const asked = built.change();
    await built.timeIsUp();

    const fault = await asked.catch((err: unknown) => err);
    expect(fault).toBeInstanceOf(Error);
    // Not a verdict on the password: a plain Error, which the filter answers as a 500.
    expect(fault).not.toBeInstanceOf(HttpException);
    expect(built.limits).toEqual([5000]);
    expect(built.updateUserById).not.toHaveBeenCalled();
  });

  // A 200 whose body never comes read as "no body": a wrong password, with the right one.
  it('ends a check whose answer stops half way as a server error too', async () => {
    const built = build(0, 'body');

    const asked = built.change();
    await built.timeIsUp();

    const fault = await asked.catch((err: unknown) => err);
    expect(fault).toBeInstanceOf(Error);
    expect(fault).not.toBeInstanceOf(HttpException);
    expect(built.updateUserById).not.toHaveBeenCalled();
  });

  it('still answers a change whose fresh login never came: the login is cleared', async () => {
    const built = build(1);

    const asked = built.change();
    await built.timeIsUp();

    expect(await asked).toEqual({ ok: true, signedIn: false });
    // The check, the password write (ruling 360), the fresh login.
    expect(built.limits).toEqual([5000, 5000, 5000]);
    expect(built.updateUserById).toHaveBeenCalledOnce();
    expect(built.reply.setCookie).not.toHaveBeenCalled();
    expect(built.reply.clearCookie).toHaveBeenCalledTimes(2);
    expect(built.warned).toHaveBeenCalledWith(expect.stringContaining('timed out'));
  });

  it('hands every call its own limit', async () => {
    const built = build(1);

    const asked = built.change();
    await built.timeIsUp();
    await asked;

    const signals = built.fetched.mock.calls.map(([, init]) => init.signal);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).toBeInstanceOf(AbortSignal);
    expect(signals[0]).not.toBe(signals[1]);
  });
});
