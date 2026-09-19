/**
 * `requireRequestUserId`: the caller's id, or 401. The persons and registrations
 * routes share it, so each branch is pinned here rather than through one of them.
 */
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { requireRequestUserId } from './request-user';

/** `getAuthUser` answering with `user`: null is a token the session check rejects. */
const supabase = (user: { id: string } | null) => ({ getAuthUser: vi.fn(async () => user) });

const request = (headers: Record<string, string>, cookies: Record<string, string> = {}) =>
  ({ headers, cookies }) as never;

describe('requireRequestUserId', () => {
  it('refuses a request with no token, without asking for a session', async () => {
    const db = supabase({ id: 'u1' });
    const call = requireRequestUserId(request({}), db as never);
    await expect(call).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(call).rejects.toThrow('Authentication required');
    expect(db.getAuthUser).not.toHaveBeenCalled();
  });

  it('refuses a token the session check rejects', async () => {
    const call = requireRequestUserId(
      request({ authorization: 'Bearer t' }),
      supabase(null) as never,
    );
    await expect(call).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(call).rejects.toThrow('Invalid or expired session');
  });

  it('checks the Bearer token before the session cookie', async () => {
    const db = supabase({ id: 'u1' });
    const caller = request({ authorization: 'Bearer from-header' }, { 'sb-access-token': 'c' });
    await expect(requireRequestUserId(caller, db as never)).resolves.toBe('u1');
    expect(db.getAuthUser).toHaveBeenCalledWith('from-header');
  });

  it('reads the session cookie when no Bearer token is sent', async () => {
    const db = supabase({ id: 'u1' });
    const caller = request({}, { 'sb-access-token': 'from-cookie' });
    await expect(requireRequestUserId(caller, db as never)).resolves.toBe('u1');
    expect(db.getAuthUser).toHaveBeenCalledWith('from-cookie');
  });
});
