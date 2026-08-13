import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookies = vi.fn();
const headers = vi.fn();

vi.mock('next/headers', () => ({
  cookies: () => cookies(),
  headers: () => headers(),
}));

// vi.mock is hoisted above this, so the module under test sees the stub.
import { resolveServerLocale } from './server.js';

/** A `cookies()`/`headers()` pair as Next hands them over inside a request. */
function inRequest({
  cookie,
  acceptLanguage,
}: { cookie?: string; acceptLanguage?: string } = {}): void {
  cookies.mockResolvedValue({ get: () => (cookie === undefined ? undefined : { value: cookie }) });
  headers.mockResolvedValue({ get: () => acceptLanguage ?? null });
}

describe('resolveServerLocale', () => {
  beforeEach(() => {
    cookies.mockReset();
    headers.mockReset();
  });

  it('prefers an explicit cookie over the browser hint', async () => {
    inRequest({ cookie: 'fr', acceptLanguage: 'en-GB,en;q=0.9' });
    expect(await resolveServerLocale()).toBe('fr');
  });

  it('falls back to Accept-Language when no choice was persisted', async () => {
    inRequest({ acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8' });
    expect(await resolveServerLocale()).toBe('fr');
  });

  it('ignores an unsupported cookie value rather than trusting it', async () => {
    inRequest({ cookie: 'de', acceptLanguage: 'fr-FR,fr;q=0.9' });
    expect(await resolveServerLocale()).toBe('fr');
  });

  /**
   * The behaviour the three copies disagreed on. web-public wrapped these reads
   * in July because its perf harness renders a page with no request around it
   * and Next 16 throws there; web-admin and web-staff never got the fix. Folding
   * them together adopted the wrapper for all three, so the choice is pinned
   * here rather than left to whoever reads the try/catch next.
   */
  it('renders in the default locale off-request instead of throwing', async () => {
    cookies.mockImplementation(() => {
      throw new Error('`cookies` was called outside a request scope.');
    });
    headers.mockImplementation(() => {
      throw new Error('`headers` was called outside a request scope.');
    });

    await expect(resolveServerLocale()).resolves.toBe('en');
  });
});
