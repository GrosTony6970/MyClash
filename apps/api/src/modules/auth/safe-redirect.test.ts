import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';
import { safeRedirectPath } from './safe-redirect';
import { mockSupabase as seededSupabase } from '../../common/testing/supabase-chain';

/**
 * Where a sign-in sends its reader afterwards.
 *
 * Somebody sends Marie the address of a real claim page with `?next=//bad-site.test/landing`
 * behind it. She signs in with Google on that page. The API took every address that begins
 * with a slash, so it answered `//bad-site.test/landing`, and the callback page moved her
 * browser there: a browser reads two slashes as "another site". Proven in a browser on both
 * Google callback pages before this fix.
 *
 * An address the sign-in may send her to is a path of OUR site: `isOwnSitePath` of
 * `@myclash/types` is the rule, and holds its cases. Anything else is the home page, as before.
 */
describe('safeRedirectPath', () => {
  it.each(['//bad-site.test/landing', '/\\bad-site.test', '/.//bad-site.test', undefined, ''])(
    'sends %j to the home page',
    (asked) => {
      expect(safeRedirectPath(asked)).toBe('/');
    },
  );

  it.each(['/', '/lices', '/e/spring-open/claim?personId=row-1'])(
    'keeps %j as it was asked',
    (asked) => {
      expect(safeRedirectPath(asked)).toBe(asked);
    },
  );
});

const MARIE = { id: 'user-marie', email: 'marie@example.com' };
const BAD = '//bad-site.test/landing';

const config = {
  getOrThrow: vi.fn(() => 'http://supabase-auth:9999'),
  get: vi.fn((key: string, def?: string) => (key === 'DOMAIN' ? 'myclash.localhost' : (def ?? ''))),
};

/** Marie owns a club, so every door lets her in; the lockdown is off. */
function build() {
  const db = seededSupabase({
    platform_roles: { rows: [] },
    organization_members: { rows: [{ user_id: MARIE.id, role: 'owner' }] },
    league_user_roles: { rows: [] },
    feature_flags: { rows: [{ key: 'admin_lockdown', enabled: false }] },
  });
  const session = { access_token: 'access', refresh_token: 'refresh', user: MARIE };
  const generateLink = vi
    .fn()
    .mockResolvedValue({ data: { properties: { hashed_token: 'code-1' } }, error: null });
  const supabase = {
    getAuthUser: vi.fn().mockResolvedValue(MARIE),
    service: { ...db.service, auth: { admin: { generateLink } } },
    anon: { auth: { verifyOtp: vi.fn().mockResolvedValue({ data: { session }, error: null }) } },
  };
  const mail = { sendMagicLink: vi.fn() };
  const service = new AuthService(
    supabase as never,
    mail as never,
    config as never,
    {} as never,
    {} as LegalAcceptanceService,
    {} as never,
  );
  const reply = { setCookie: vi.fn(), clearCookie: vi.fn(), send: vi.fn(), redirect: vi.fn() };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => session }));
  return { service, reply, mail };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the sign-in doors never answer an address of another site', () => {
  it.each<['admin_login' | 'public_login', string]>([
    ['admin_login', '/dashboard'],
    ['public_login', '/me'],
  ])('the Google sign-in (%s) answers its own landing page', async (mode, landing) => {
    const { service, reply } = build();

    await service.acceptOAuthSession(
      { accessToken: 'access', refreshToken: 'refresh', mode, next: BAD },
      reply as never,
    );

    expect(reply.send).toHaveBeenCalledWith({ next: landing });
  });

  it('the Google sign-in still answers a path of ours that was asked', async () => {
    const { service, reply } = build();

    await service.acceptOAuthSession(
      { accessToken: 'access', refreshToken: 'refresh', mode: 'public_login', next: '/e/spring' },
      reply as never,
    );

    expect(reply.send).toHaveBeenCalledWith({ next: '/e/spring' });
  });

  it('the password sign-in answers the dashboard', async () => {
    const { service, reply } = build();

    await service.passwordLogin(
      { email: MARIE.email, password: 'right-password', redirectTo: BAD },
      reply as never,
    );

    expect(reply.send).toHaveBeenCalledWith({ next: '/dashboard' });
  });

  it('the password sign-in still answers a path of ours that was asked', async () => {
    const { service, reply } = build();

    await service.passwordLogin(
      { email: MARIE.email, password: 'right-password', redirectTo: '/org/lyon-amhe' },
      reply as never,
    );

    expect(reply.send).toHaveBeenCalledWith({ next: '/org/lyon-amhe' });
  });

  it.each([
    ['login', 'https://admin.myclash.localhost/dashboard'],
    ['public_login', 'https://app.myclash.localhost/me'],
    ['claim', 'https://app.myclash.localhost/'],
  ])('the mailed link (%s) lands on its own page', async (type, landing) => {
    const { service, reply } = build();

    await service.handleCallback('token-hash', type, undefined, BAD, reply as never);

    expect(reply.redirect).toHaveBeenCalledWith(landing);
  });

  it('a mail that is asked for with such an address carries the home page', async () => {
    const { service, mail } = build();

    await service.requestMagicLink({ email: MARIE.email, type: 'public_login', redirectTo: BAD });

    expect(mail.sendMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        magicLink:
          'https://api.myclash.localhost/api/v1/auth/callback?type=public_login&next=%2F&token_hash=code-1',
      }),
    );
  });
});
