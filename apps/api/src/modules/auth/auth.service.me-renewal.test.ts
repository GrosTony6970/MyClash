import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as jwt from 'jsonwebtoken';
import type { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';
import { mockSupabase as seededSupabase } from '../../common/testing/supabase-chain';

/**
 * `/me` renews a login that is about to end, not only one that has ended
 * (operator ruling 94).
 *
 * A hall screen signed in as a club member reads a hidden bout every two
 * seconds. The access token inside its cookie lives one hour; the moment it
 * expires, the API reads the screen as a stranger and the bout answers "not
 * found". Display pages call `/me` every minute, and `/me` renews the login
 * once it has under five minutes left, so the token is replaced before it ends.
 */
const USER = { id: 'user-1', email: 'member@example.com', user_metadata: {} };

const supabase = {
  getAuthUser: vi.fn(),
  refreshSession: vi.fn(),
  service: seededSupabase({ persons: { rows: [] } }),
};

const config = {
  getOrThrow: vi.fn(),
  get: vi.fn((key: string, def?: string) => (key === 'DOMAIN' ? 'myclash.localhost' : (def ?? ''))),
};

/** An access token that ends `seconds` from now (the signature is never checked here). */
const tokenEndingIn = (seconds: number) =>
  jwt.sign({ sub: USER.id, exp: Math.floor(Date.now() / 1000) + seconds }, 'test-secret');

function makeReply() {
  return { setCookie: vi.fn(), clearCookie: vi.fn(), send: vi.fn(), redirect: vi.fn() };
}

const signedIn = (accessToken: string) =>
  ({
    headers: { authorization: `Bearer ${accessToken}` },
    cookies: { 'sb-refresh-token': 'old-refresh' },
  }) as never;

describe('AuthService.getMe — a login about to end is renewed early', () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    // GoTrue accepts both the current and the renewed token.
    supabase.getAuthUser.mockResolvedValue(USER);
    supabase.refreshSession.mockResolvedValue({
      access_token: 'fresh-access',
      refresh_token: 'fresh-refresh',
      expires_in: 3600,
    });
    service = new AuthService(
      supabase as never,
      { sendMagicLink: vi.fn() } as never,
      config as never,
      {} as never,
      { pendingFor: vi.fn().mockResolvedValue([]) } as unknown as LegalAcceptanceService,
    );
  });

  it('renews a login with under five minutes left, and the caller stays signed in', async () => {
    const reply = makeReply();
    const me = await service.getMe(signedIn(tokenEndingIn(120)), reply as never);

    expect(supabase.refreshSession).toHaveBeenCalledWith('old-refresh');
    expect(reply.setCookie).toHaveBeenCalledWith(
      'sb-access-token',
      'fresh-access',
      expect.anything(),
    );
    expect(reply.setCookie).toHaveBeenCalledWith(
      'sb-refresh-token',
      'fresh-refresh',
      expect.anything(),
    );
    expect(me.type).toBe('claimed');
  });

  it('leaves a login with more than five minutes left alone', async () => {
    const reply = makeReply();
    const me = await service.getMe(signedIn(tokenEndingIn(600)), reply as never);

    expect(supabase.refreshSession).not.toHaveBeenCalled();
    expect(reply.setCookie).not.toHaveBeenCalled();
    expect(me.type).toBe('claimed');
  });

  it('keeps a still-valid login when the early renewal is refused', async () => {
    supabase.refreshSession.mockResolvedValue(null);
    const reply = makeReply();
    const me = await service.getMe(signedIn(tokenEndingIn(120)), reply as never);

    expect(reply.setCookie).not.toHaveBeenCalled();
    expect(me.type).toBe('claimed');
  });

  it('keeps a still-valid login when the renewed token does not validate yet', async () => {
    const current = tokenEndingIn(120);
    supabase.getAuthUser.mockImplementation(async (token: string) =>
      token === current ? USER : null,
    );
    const reply = makeReply();
    const me = await service.getMe(signedIn(current), reply as never);

    expect(supabase.refreshSession).toHaveBeenCalledWith('old-refresh');
    expect(reply.setCookie).toHaveBeenCalledWith(
      'sb-access-token',
      'fresh-access',
      expect.anything(),
    );
    expect(me.type).toBe('claimed');
  });

  it('does not renew without a reply to write the cookies to', async () => {
    const me = await service.getMe(signedIn(tokenEndingIn(120)));

    expect(supabase.refreshSession).not.toHaveBeenCalled();
    expect(me.type).toBe('claimed');
  });
});
