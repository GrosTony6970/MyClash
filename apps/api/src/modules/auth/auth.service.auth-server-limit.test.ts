import { HttpException, UnauthorizedException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';

/**
 * The auth server's other calls at the password doors and the mailed-link doors
 * (operator ruling 360).
 *
 * Saturday 10:00, the auth server is overloaded. Paul clicks his reset mail and types a new
 * password. When the auth server answered "too many requests" about his code, his page said
 * "This link has expired" over a link nobody had judged. When it answered nothing, the API
 * waited with no limit. The code of a mailed link, the password write and the account delete
 * each stop after five seconds now, and an answer that is no judgment is a server error.
 */
const PAUL = { id: 'user-paul', email: 'paul@example.com', identities: [{ provider: 'email' }] };
const NEW_PASSWORD = 'A-much-Longer-passw0rd!';
const SESSION = { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user: PAUL };
const NEVER = () => new Promise<never>(() => undefined);

const config = {
  getOrThrow: vi.fn(() => 'http://supabase-auth:9999'),
  get: vi.fn((key: string, def?: string) => (key === 'DOMAIN' ? 'myclash.localhost' : (def ?? ''))),
};

type AuthCall = () => Promise<unknown>;

/** Every limit a call asked for, and the clock that runs the newest one out. */
function limitClocks() {
  const limits: number[] = [];
  const clocks: AbortController[] = [];
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    limits.push(ms);
    clocks.push(new AbortController());
    return clocks.at(-1)!.signal;
  });
  /** The limit of the newest call runs out, once `asked` was called. */
  const timeIsUp = async (asked: ReturnType<typeof vi.fn>) => {
    await vi.waitFor(() => expect(asked).toHaveBeenCalled());
    clocks.at(-1)!.abort();
  };
  return { limits, timeIsUp };
}

function build(calls: { code?: AuthCall; write?: AuthCall; remove?: AuthCall } = {}) {
  const clocks = limitClocks();
  // The password door: it knows Paul's current password, and signs him in with the new one.
  const fetched = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ access_token: 'fresh', refresh_token: 'fresh-refresh', user: PAUL }),
  }));
  vi.stubGlobal('fetch', fetched);
  const verifyOtp = vi.fn(
    calls.code ?? (async () => ({ data: { user: PAUL, session: SESSION }, error: null })),
  );
  const updateUserById = vi.fn(calls.write ?? (async () => ({ error: null })));
  const deleteUser = vi.fn(calls.remove ?? (async () => ({ error: null })));
  const erasure = { redactSubject: vi.fn(async () => ({})), recordErasure: vi.fn() };
  const supabase = {
    getAuthUser: vi.fn().mockResolvedValue(PAUL),
    anon: { auth: { verifyOtp } },
    service: { auth: { admin: { updateUserById, deleteUser } } },
  };
  const service = new AuthService(
    supabase as never,
    { sendMagicLink: vi.fn() } as never,
    config as never,
    erasure as never,
    {} as unknown as LegalAcceptanceService,
    {} as never,
  );
  vi.spyOn(service, 'tryAutolinkGlobalPerson').mockResolvedValue(undefined);
  const reply = { setCookie: vi.fn(), clearCookie: vi.fn(), send: vi.fn() };
  return { ...clocks, service, reply, fetched, verifyOtp, updateUserById, deleteUser, erasure };
}

type Built = ReturnType<typeof build>;
const signedIn = { headers: { authorization: 'Bearer access' } } as never;
const reset = (built: Built) =>
  built.service.publicPasswordResetConfirm('token-hash-0001', NEW_PASSWORD, built.reply as never);
const followLink = (built: Built) =>
  built.service.signInFromSignupLink('token-hash-0001', built.reply as never);
const change = (built: Built) =>
  built.service.changePassword(signedIn, 'old-password', NEW_PASSWORD, built.reply as never);
const remove = (built: Built) =>
  built.service.deleteAccount(signedIn, 'old-password', 'DELETE', built.reply as never);

/** A fault that is no answer of the API's own: the filter answers it as a 500. */
async function serverFault(asked: Promise<unknown>): Promise<void> {
  const fault = await asked.catch((err: unknown) => err);
  expect(fault).toBeInstanceOf(Error);
  expect(fault).not.toBeInstanceOf(HttpException);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// What supabase-js hands the API as `error` for each answer of the auth server.
const NO_JUDGMENT: [string, { message: string; status?: number }][] = [
  ['is throttled', { message: 'too many requests', status: 429 }],
  ['has a fault', { message: 'unexpected failure', status: 500 }],
  ['is behind a dead gateway', { message: 'bad gateway', status: 502 }],
  ['is not reached', { message: 'fetch failed', status: 0 }],
  ['answers what cannot be read', { message: 'Unexpected token <' }],
];
// A code that is made up, used or past its life: read on GoTrue v2.195.0.
const REFUSED = { message: 'Email link is invalid or has expired', status: 403 };
const answers = (error: object) => async () => ({ data: { user: null, session: null }, error });

describe('a mailed code the auth server did not judge is never "expired" (ruling 360)', () => {
  it.each(NO_JUDGMENT)('the reset door answers a server error when it %s', async (_w, error) => {
    const built = build({ code: answers(error) });

    await serverFault(reset(built));

    expect(built.updateUserById).not.toHaveBeenCalled();
    expect(built.reply.send).not.toHaveBeenCalled();
  });

  // The service's fault. The link's door turns it into a page (`auth.service.dead-link.test.ts`).
  it.each(NO_JUDGMENT)('the sign-in of a mailed link fails when it %s', async (_w, error) => {
    const built = build({ code: answers(error) });

    await serverFault(followLink(built));

    expect(built.reply.setCookie).not.toHaveBeenCalled();
  });

  it('still says "expired" for a code the auth server refused', async () => {
    const atReset = build({ code: answers(REFUSED) });
    const atLink = build({ code: answers(REFUSED) });

    await expect(reset(atReset)).rejects.toThrow(UnauthorizedException);
    await expect(followLink(atLink)).rejects.toThrow(UnauthorizedException);
    expect(atReset.updateUserById).not.toHaveBeenCalled();
  });

  it('asks for the code of a reset as a reset, and of a link as a sign-in', async () => {
    const atReset = build();
    const atLink = build();

    await reset(atReset);
    await followLink(atLink);

    expect(atReset.verifyOtp).toHaveBeenCalledWith({
      token_hash: 'token-hash-0001',
      type: 'recovery',
    });
    expect(atLink.verifyOtp).toHaveBeenCalledWith({ token_hash: 'token-hash-0001', type: 'email' });
  });
});

describe('each call to the auth server stops after five seconds (ruling 360)', () => {
  it('the code of a reset: a server error, and nothing is written', async () => {
    const built = build({ code: NEVER });

    const asked = reset(built);
    await built.timeIsUp(built.verifyOtp);

    await serverFault(asked);
    expect(built.limits).toEqual([5000]);
    expect(built.updateUserById).not.toHaveBeenCalled();
  });

  it('the code of a mailed link: a server error, and nobody is signed in', async () => {
    const built = build({ code: NEVER });

    const asked = followLink(built);
    await built.timeIsUp(built.verifyOtp);

    await serverFault(asked);
    expect(built.limits).toEqual([5000]);
    expect(built.reply.setCookie).not.toHaveBeenCalled();
  });

  it('the password write of a reset: a server error, and no sign-in is asked', async () => {
    const built = build({ write: NEVER });

    const asked = reset(built);
    await built.timeIsUp(built.updateUserById);

    await serverFault(asked);
    expect(built.limits).toEqual([5000, 5000]);
    expect(built.fetched).not.toHaveBeenCalled();
    expect(built.reply.send).not.toHaveBeenCalled();
  });

  it('the password write of a change: a server error, after the one check', async () => {
    const built = build({ write: NEVER });

    const asked = change(built);
    await built.timeIsUp(built.updateUserById);

    await serverFault(asked);
    expect(built.updateUserById).toHaveBeenCalledWith(PAUL.id, { password: NEW_PASSWORD });
    // The check of the current password, and no sign-in with the new one.
    expect(built.fetched).toHaveBeenCalledOnce();
    expect(built.reply.setCookie).not.toHaveBeenCalled();
  });

  it('the account delete: a server error, no receipt, and the login stays', async () => {
    const built = build({ remove: NEVER });

    const asked = remove(built);
    await built.timeIsUp(built.deleteUser);

    await serverFault(asked);
    expect(built.deleteUser).toHaveBeenCalledWith(PAUL.id);
    expect(built.erasure.recordErasure).not.toHaveBeenCalled();
    expect(built.reply.clearCookie).not.toHaveBeenCalled();
  });
});
