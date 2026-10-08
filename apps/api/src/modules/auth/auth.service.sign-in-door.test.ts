import { ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';
import { OperationalUnavailableException } from '../../common/operational-exception';
import {
  mockSupabase as seededSupabase,
  type TableSeed,
} from '../../common/testing/supabase-chain';

/**
 * The admin sign-in door during a database fault (operator ruling 301).
 *
 * Marc is an organiser. He types the right password during a short database fault: the read
 * of his clubs fails. The door read that as "no club" and told him "No organizer or super admin
 * access for this account". A failed read now fails the sign-in with a server error and a
 * trace; "no access" is said only when the three reads worked and found nothing. No cookie is
 * set either way. The guards keep their own fail-closed helper (ruling 295).
 */
const MARC = { id: 'user-marc', email: 'marc@example.com' };
const OTHER = 'user-other';
const FAULT = { data: null, error: { message: 'statement timeout' } };

/** The three reads of the door, each with a row of ANOTHER account as a decoy. */
const TABLES: Record<string, TableSeed> = {
  platform_roles: { rows: [{ user_id: OTHER, role: 'super_admin' }] },
  organization_members: { rows: [{ user_id: OTHER, role: 'owner' }] },
  league_user_roles: { rows: [{ user_id: OTHER, role: 'admin' }] },
};

const config = {
  getOrThrow: vi.fn(() => 'http://supabase-auth:9999'),
  get: vi.fn((key: string, def?: string) => (key === 'DOMAIN' ? 'myclash.localhost' : (def ?? ''))),
};

function build(over: Record<string, TableSeed> = {}, auth: object = {}) {
  const db = seededSupabase({ ...TABLES, ...over });
  const supabase = { getAuthUser: vi.fn().mockResolvedValue(MARC), service: db.service, ...auth };
  const service = new AuthService(
    supabase as never,
    { sendMagicLink: vi.fn() } as never,
    config as never,
    {} as never,
    {} as LegalAcceptanceService,
    {} as never,
  );
  const reply = { setCookie: vi.fn(), clearCookie: vi.fn(), send: vi.fn(), redirect: vi.fn() };
  const google = () =>
    service.acceptOAuthSession(
      { accessToken: 'access', refreshToken: 'refresh', mode: 'admin_login' },
      reply as never,
    );
  const password = () =>
    service.passwordLogin(
      { email: MARC.email, password: 'right-password' } as never,
      reply as never,
    );
  return { google, password, reply, service };
}

/** The auth server takes the password. */
function rightPassword(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'access', refresh_token: 'refresh', user: MARC }),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the admin sign-in door when a read fails (ruling 301)', () => {
  it.each(['platform_roles', 'organization_members', 'league_user_roles'])(
    'fails the Google sign-in with a plain error when %s cannot be read',
    async (table) => {
      const { google, reply } = build({ [table]: FAULT });

      const failure = await google().catch((err: unknown) => err);

      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(HttpException);
      expect((failure as Error).message).toContain('statement timeout');
      expect(reply.setCookie).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    },
  );

  it('fails the password sign-in the same way', async () => {
    rightPassword();
    const { password, reply } = build({ organization_members: FAULT });

    const failure = await password().catch((err: unknown) => err);

    expect(failure).not.toBeInstanceOf(HttpException);
    expect((failure as Error).message).toContain('statement timeout');
    expect(reply.setCookie).not.toHaveBeenCalled();
  });

  it('still says "no access" when the three reads work and find nothing of his', async () => {
    const { google, reply } = build();

    await expect(google()).rejects.toThrow(ForbiddenException);
    expect(reply.setCookie).not.toHaveBeenCalled();
  });
});

/**
 * The maintenance lockdown at the same door (operator ruling 308).
 *
 * A super admin switches the lockdown on, and Marc signs in. The door answered a plain 503, and
 * the API replaces the words of every plain 5xx: the password form said "Internal server error"
 * and the Google callback "not authorized". The refusal now carries its own code and keeps its
 * words, so each screen can say the lockdown and nothing else for it.
 */
describe('the admin sign-in door during the maintenance lockdown (ruling 308)', () => {
  const LOCKED: Record<string, TableSeed> = {
    feature_flags: { rows: [{ key: 'admin_lockdown', enabled: true }] },
    organization_members: { rows: [{ user_id: MARC.id, role: 'owner' }] },
  };

  it.each<'google' | 'password'>(['google', 'password'])(
    'refuses the %s sign-in with the coded 503 its screen reads, and no cookie',
    async (door) => {
      rightPassword();
      const built = build(LOCKED);

      const refusal = await built[door]().catch((err: unknown) => err);

      expect(refusal).toBeInstanceOf(OperationalUnavailableException);
      expect((refusal as HttpException).getStatus()).toBe(503);
      expect((refusal as HttpException).getResponse()).toMatchObject({ code: 'admin_lockdown' });
      expect(built.reply.setCookie).not.toHaveBeenCalled();
    },
  );

  it('refuses the mailed sign-up link with the same coded 503', async () => {
    const verifyOtp = vi.fn().mockResolvedValue({
      data: { session: { access_token: 'access', refresh_token: 'refresh', user: MARC } },
      error: null,
    });
    const { service, reply } = build(LOCKED, { anon: { auth: { verifyOtp } } });

    const refusal = await service
      .signInFromSignupLink('token-hash', reply as never)
      .catch((err: unknown) => err);

    expect(refusal).toBeInstanceOf(OperationalUnavailableException);
    expect(reply.setCookie).not.toHaveBeenCalled();
  });

  // Operator ruling 324. A browser that followed a mailed link cannot read a 503: Marc saw
  // raw English text. The code is spent by then (only the spent code names the account, and
  // platform staff pass), so he lands on the sign-in page, which says the lockdown.
  const landOn = (type: string, over: Record<string, TableSeed> = {}) => {
    const verifyOtp = vi.fn().mockResolvedValue({
      data: { session: { access_token: 'access', refresh_token: 'refresh', user: MARC } },
      error: null,
    });
    const built = build({ ...LOCKED, ...over }, { anon: { auth: { verifyOtp } } });
    vi.spyOn(built.service, 'tryAutolinkGlobalPerson').mockResolvedValue(undefined);
    const land = () =>
      built.service.handleCallback('token-hash', type, undefined, undefined, built.reply as never);
    return { ...built, land };
  };

  it('sends the reader of a mailed sign-in link to the sign-in page with the reason', async () => {
    const { land, reply } = landOn('login');

    await land();

    expect(reply.redirect.mock.calls).toEqual([
      ['https://admin.myclash.localhost/login?refused=admin_lockdown'],
    ]);
    expect(reply.setCookie).not.toHaveBeenCalled();
  });

  it('still lets platform staff in by a mailed sign-in link', async () => {
    const { land, reply } = landOn('login', {
      platform_roles: { rows: [{ user_id: MARC.id, role: 'platform_admin' }] },
    });

    await land();

    expect(reply.redirect.mock.calls).toEqual([['https://admin.myclash.localhost/dashboard']]);
    expect(reply.setCookie).toHaveBeenCalled();
  });

  it('keeps the participant app open: its mailed link is not an admin sign-in', async () => {
    const { land, reply } = landOn('public_login');

    await land();

    expect(reply.redirect.mock.calls).toEqual([['https://app.myclash.localhost/me']]);
  });

  it('still fails on a spent or unknown code, with no redirect', async () => {
    // What the auth server answers for a code it refuses: a 403 (read on GoTrue v2.195.0).
    const refused = { message: 'expired', status: 403 };
    const verifyOtp = vi.fn().mockResolvedValue({ data: {}, error: refused });
    const { service, reply } = build(LOCKED, { anon: { auth: { verifyOtp } } });

    await expect(
      service.handleCallback('token-hash', 'login', undefined, undefined, reply as never),
    ).rejects.toThrow(UnauthorizedException);
    expect(reply.redirect).not.toHaveBeenCalled();
  });

  it('lets an organizer in while the lockdown is off', async () => {
    const { google, reply } = build({
      ...LOCKED,
      feature_flags: { rows: [{ key: 'admin_lockdown', enabled: false }] },
    });

    await google();

    expect(reply.send).toHaveBeenCalledWith({ next: '/dashboard' });
  });
});

/**
 * "Wrong email or password" is said for a wrong password only (operator ruling 309).
 *
 * The form reads every 401 of this door as a wrong password. The door answered that 401 for
 * every failure of its call to the auth server: Marc typed the right password while the auth
 * server was down or throttled, and would have read "Wrong email or password".
 */
describe('the password sign-in when the auth server does not judge the password (ruling 309)', () => {
  const answers = (status: number) =>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ error: 'x' }) }),
    );

  it.each([429, 500, 502, 503])('fails with a plain error when it answers %s', async (status) => {
    answers(status);
    const { password, reply } = build();

    const failure = await password().catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect((failure as Error).message).toContain(String(status));
    expect(reply.setCookie).not.toHaveBeenCalled();
  });

  it('fails with a plain error when it does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')));
    const { password } = build();

    const failure = await password().catch((err: unknown) => err);

    expect(failure).not.toBeInstanceOf(HttpException);
    expect((failure as Error).message).toContain('ECONNREFUSED');
  });

  it('answers a 401 when it refuses the password', async () => {
    answers(400);
    const { password } = build();

    await expect(password()).rejects.toThrow(UnauthorizedException);
  });
});
