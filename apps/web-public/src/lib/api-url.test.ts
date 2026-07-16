import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublicApiUrl, getServerApiUrl } from './api-url';

/**
 * These lock the property the split exists to guarantee: `getPublicApiUrl`
 * NEVER yields the docker-internal host, and `getServerApiUrl` prefers it.
 *
 * Neither helper branches on `typeof window` any more — that branch was the
 * bug. A client component's module is evaluated twice (once in the SSR pass,
 * once in the browser), so a window-dependent helper returned two different
 * values for the same call site. The window stubbing below asserts the absence
 * of that branch rather than exercising it.
 */
describe('api-url', () => {
  let originalWindow: typeof globalThis.window | undefined;

  beforeEach(() => {
    originalWindow = (globalThis as { window?: unknown }).window as
      | typeof globalThis.window
      | undefined;
    vi.stubEnv('API_URL_INTERNAL', '');
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  describe('getServerApiUrl', () => {
    it('prefers API_URL_INTERNAL', () => {
      vi.stubEnv('API_URL_INTERNAL', 'http://api:4000');
      vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.myclash.fr');
      expect(getServerApiUrl()).toBe('http://api:4000');
    });

    it('falls back to NEXT_PUBLIC_API_URL when internal is unset', () => {
      vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.myclash.fr');
      expect(getServerApiUrl()).toBe('https://api.myclash.fr');
    });

    it('defaults to http://localhost:4000 when nothing is configured', () => {
      expect(getServerApiUrl()).toBe('http://localhost:4000');
    });
  });

  describe('getPublicApiUrl', () => {
    it('ignores API_URL_INTERNAL', () => {
      vi.stubEnv('API_URL_INTERNAL', 'http://api:4000');
      vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.myclash.fr');
      expect(getPublicApiUrl()).toBe('https://api.myclash.fr');
    });

    it('treats an empty NEXT_PUBLIC_API_URL as unset rather than returning ""', () => {
      vi.stubEnv('API_URL_INTERNAL', 'http://api:4000');
      vi.stubEnv('NEXT_PUBLIC_API_URL', '   ');
      expect(getPublicApiUrl()).toBe('http://localhost:4000');
    });

    // The regression that made /me show "Could not load your personal space":
    // a server-evaluated getApiUrl() returned the internal host and that value
    // reached the browser. getPublicApiUrl must be window-independent.
    it('returns the public host with no window (SSR pass), never the internal one', () => {
      delete (globalThis as { window?: unknown }).window;
      vi.stubEnv('API_URL_INTERNAL', 'http://api:4000');
      vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.myclash.fr');
      expect(getPublicApiUrl()).toBe('https://api.myclash.fr');
    });

    it('returns the same value with and without a window', () => {
      vi.stubEnv('API_URL_INTERNAL', 'http://api:4000');
      vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.myclash.fr');
      delete (globalThis as { window?: unknown }).window;
      const ssrPass = getPublicApiUrl();
      (globalThis as { window?: unknown }).window = {} as never;
      expect(getPublicApiUrl()).toBe(ssrPass);
    });
  });
});
