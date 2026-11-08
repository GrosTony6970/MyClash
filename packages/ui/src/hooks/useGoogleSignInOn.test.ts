import { afterEach, describe, expect, it, vi } from 'vitest';
import { googleSignInOn } from './useGoogleSignInOn';

/**
 * Google is off in production. A fencer who taps "Continue with Google" lands on the sign-in
 * server's bare "provider is not enabled" page (ruling 495). So the button asks the sign-in
 * server first, and shows on a yes only.
 */

const AUTH = 'https://app.myclash.test';

function answers(status: number, body: unknown) {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

describe('googleSignInOn', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is yes when the sign-in server's settings say Google is on", async () => {
    const fetchImpl = answers(200, { external: { email: true, google: true } });

    await expect(googleSignInOn(AUTH, fetchImpl)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(`${AUTH}/auth/v1/settings`, { credentials: 'omit' });
  });

  it('is no when the settings say Google is off, or do not name it', async () => {
    await expect(googleSignInOn(AUTH, answers(200, { external: { google: false } }))).resolves.toBe(
      false,
    );
    await expect(googleSignInOn(AUTH, answers(200, { external: { email: true } }))).resolves.toBe(
      false,
    );
    await expect(
      googleSignInOn(AUTH, answers(200, { external: { google: 'true' } })),
    ).resolves.toBe(false);
  });

  it('is no, and says why, when the sign-in server refuses', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(googleSignInOn(AUTH, answers(503, { external: { google: true } }))).resolves.toBe(
      false,
    );
    expect(warn).toHaveBeenCalledWith(
      'Google sign-in hidden: its setting could not be read',
      new Error('the sign-in server answered 503'),
    );
  });

  it('is no, and says why, when the sign-in server cannot be reached', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    await expect(googleSignInOn(AUTH, fetchImpl)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(
      'Google sign-in hidden: its setting could not be read',
      new TypeError('Failed to fetch'),
    );
  });

  it('asks nothing, and says why, when the site does not know where the sign-in server is', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = answers(200, { external: { google: true } });

    await expect(googleSignInOn(undefined, fetchImpl)).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('Google sign-in hidden: NEXT_PUBLIC_SUPABASE_URL is not set');
  });
});
