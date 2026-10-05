import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';
import {
  mockSupabase as seededSupabase,
  type TableSeed,
} from '../../common/testing/supabase-chain';

/**
 * `AuthService.signInFromSignupLink`: the emailed sign-up link signs its reader in and hands
 * back the account the link proved (operator ruling 299). It sends no answer of its own: the
 * sign-up door makes the club and then redirects, once.
 */
const ANNA = { id: 'user-anna', email: 'anna@example.com' };
const verifyOtp = vi.fn();

const config = {
  getOrThrow: vi.fn(),
  get: vi.fn((key: string, def?: string) => (key === 'DOMAIN' ? 'myclash.localhost' : (def ?? ''))),
};

/** The tables a sign-in reads: the lockdown flag, the platform role, and the autolink's two. */
const TABLES: Record<string, TableSeed> = {
  feature_flags: { rows: [{ key: 'admin_lockdown', enabled: false }] },
  platform_roles: { rows: [] },
  global_persons: { rows: [] },
  persons: { rows: [] },
};

function build(over: Record<string, TableSeed> = {}) {
  const db = seededSupabase({ ...TABLES, ...over });
  const supabase = { service: db.service, anon: { auth: { verifyOtp } } };
  const service = new AuthService(
    supabase as never,
    { sendMagicLink: vi.fn() } as never,
    config as never,
    {} as never,
    {} as LegalAcceptanceService,
    {} as never,
  );
  const reply = { setCookie: vi.fn(), clearCookie: vi.fn(), send: vi.fn(), redirect: vi.fn() };
  return { service, reply };
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyOtp.mockResolvedValue({
    data: {
      session: { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user: ANNA },
    },
    error: null,
  });
});

describe('AuthService.signInFromSignupLink (ruling 299)', () => {
  it('exchanges the code, sets both cookies and hands back the link’s account', async () => {
    const { service, reply } = build();

    await expect(service.signInFromSignupLink('token-hash', reply as never)).resolves.toMatchObject(
      ANNA,
    );

    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'token-hash', type: 'email' });
    expect(reply.setCookie.mock.calls.map(([name, value]) => [name, value])).toEqual([
      ['sb-access-token', 'access'],
      ['sb-refresh-token', 'refresh'],
    ]);
  });

  it('sends no answer of its own: the sign-up door redirects, once', async () => {
    const { service, reply } = build();

    await service.signInFromSignupLink('token-hash', reply as never);

    expect(reply.redirect).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('refuses a link GoTrue does not take, and sets no cookie', async () => {
    verifyOtp.mockResolvedValue({ data: { session: null }, error: { message: 'expired' } });
    const { service, reply } = build();

    await expect(service.signInFromSignupLink('token-hash', reply as never)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(reply.setCookie).not.toHaveBeenCalled();
  });

  it('is an admin sign-in: refused while the lockdown is on, with no cookie', async () => {
    const { service, reply } = build({
      feature_flags: { rows: [{ key: 'admin_lockdown', enabled: true }] },
    });

    await expect(service.signInFromSignupLink('token-hash', reply as never)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(reply.setCookie).not.toHaveBeenCalled();
  });
});
