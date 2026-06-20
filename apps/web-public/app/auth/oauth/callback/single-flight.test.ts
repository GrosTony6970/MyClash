import { describe, expect, it, vi } from 'vitest';
import { runOAuthCodeOnce } from './single-flight';

describe('runOAuthCodeOnce', () => {
  it('runs one PKCE exchange and one server session POST for duplicate OAuth codes', async () => {
    const exchangeCodeForSession = vi.fn(async () => ({
      data: {
        session: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
        },
      },
      error: null,
    }));
    const postServerSession = vi.fn(async () => ({ next: '/me/fighter' }));

    const results = await Promise.all([
      runOAuthCodeOnce('code-123', async () => {
        const { data } = await exchangeCodeForSession('code-123');
        return postServerSession({
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
        });
      }),
      runOAuthCodeOnce('code-123', async () => {
        const { data } = await exchangeCodeForSession('code-123');
        return postServerSession({
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
        });
      }),
    ]);

    expect(results).toEqual([{ next: '/me/fighter' }, { next: '/me/fighter' }]);
    expect(exchangeCodeForSession).toHaveBeenCalledOnce();
    expect(postServerSession).toHaveBeenCalledOnce();
  });
});
