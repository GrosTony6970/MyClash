import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAppOrigin } from './app-origin';

describe('getAppOrigin', () => {
  beforeEach(() => {
    vi.stubEnv('PUBLIC_APP_ORIGIN', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the configured origin', () => {
    vi.stubEnv('PUBLIC_APP_ORIGIN', 'https://app.myclash.fr');
    expect(getAppOrigin()).toBe('https://app.myclash.fr');
  });

  it('falls back to the dev port when unset', () => {
    // Not a cosmetic default: sitemap.ts and robots.ts call `new URL()` on this,
    // which throws on an empty string and would 500 the route rather than
    // degrade.
    expect(getAppOrigin()).toBe('http://localhost:3001');
  });

  it('treats an empty or whitespace value as unset', () => {
    // A deployment that sets the var to '' would otherwise pass `??` and emit
    // `https:///e/foo`-shaped URLs into a sitemap search engines then fetch.
    for (const blank of ['', '   ', '\t']) {
      vi.stubEnv('PUBLIC_APP_ORIGIN', blank);
      expect(getAppOrigin()).toBe('http://localhost:3001');
    }
  });

  it('strips a trailing slash so callers can always concatenate a path', () => {
    // Every caller builds `${origin}${path}` with a leading-slash path. Without
    // this, an operator's trailing slash yields `https://app.myclash.fr//e/x` —
    // a different URL to a crawler, and a duplicate of one already in the map.
    vi.stubEnv('PUBLIC_APP_ORIGIN', 'https://app.myclash.fr/');
    expect(getAppOrigin()).toBe('https://app.myclash.fr');
    vi.stubEnv('PUBLIC_APP_ORIGIN', 'https://app.myclash.fr///');
    expect(getAppOrigin()).toBe('https://app.myclash.fr');
  });
});
