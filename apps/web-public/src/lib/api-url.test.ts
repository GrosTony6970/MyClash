import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApiUrl } from './api-url';

/**
 * Server-vs-browser branch behavior is locked here so a future
 * change to the helper can't silently regress SSR routing inside
 * the docker network. The four cases mirror the four reachable
 * branches of getApiUrl.
 */
describe('getApiUrl', () => {
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

  it('prefers API_URL_INTERNAL when server-side', () => {
    delete (globalThis as { window?: unknown }).window;
    vi.stubEnv('API_URL_INTERNAL', 'http://api:4000');
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.myclash.fr');
    expect(getApiUrl()).toBe('http://api:4000');
  });

  it('falls back to NEXT_PUBLIC_API_URL server-side when internal is unset', () => {
    delete (globalThis as { window?: unknown }).window;
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.myclash.fr');
    expect(getApiUrl()).toBe('https://api.myclash.fr');
  });

  it('uses NEXT_PUBLIC_API_URL when browser-side, ignoring API_URL_INTERNAL', () => {
    (globalThis as { window?: unknown }).window = {} as never;
    vi.stubEnv('API_URL_INTERNAL', 'http://api:4000');
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.myclash.fr');
    expect(getApiUrl()).toBe('https://api.myclash.fr');
  });

  it('defaults to http://localhost:4000 when nothing is configured', () => {
    delete (globalThis as { window?: unknown }).window;
    expect(getApiUrl()).toBe('http://localhost:4000');
  });
});
