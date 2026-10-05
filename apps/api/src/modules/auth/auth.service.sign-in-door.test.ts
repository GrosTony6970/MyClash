import { ForbiddenException, HttpException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';
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

function build(over: Record<string, TableSeed> = {}) {
  const db = seededSupabase({ ...TABLES, ...over });
  const supabase = { getAuthUser: vi.fn().mockResolvedValue(MARC), service: db.service };
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
  return { google, password, reply };
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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'access', refresh_token: 'refresh', user: MARC }),
      }),
    );
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
