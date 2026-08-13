import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BROWSER_API_BASE, getApiUrl } from './api-url';

/**
 * These lock the property the pad's routing depends on: in a browser the base
 * is ALWAYS same-origin, whatever the build baked in. The scoring bundle is
 * served from staff.${DOMAIN} and from admin.${DOMAIN}/staff/* by the same
 * image, so an absolute base is wrong on at least one of them — and in this
 * deploy the configured host also carries an untrusted cert, which makes the
 * failure silent rather than loud.
 */
const ORIGINAL = process.env['NEXT_PUBLIC_API_URL'];

let originalWindow: typeof globalThis.window | undefined;

beforeEach(() => {
  originalWindow = (globalThis as { window?: unknown }).window as
    typeof globalThis.window | undefined;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env['NEXT_PUBLIC_API_URL'];
  else process.env['NEXT_PUBLIC_API_URL'] = ORIGINAL;
  if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = originalWindow;
});

describe('BROWSER_API_BASE', () => {
  it('is the empty string, i.e. relative to the current origin', () => {
    expect(BROWSER_API_BASE).toBe('');
  });
});

describe('getApiUrl in a browser', () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {} as never;
  });

  it('is same-origin regardless of what the build baked in', () => {
    process.env['NEXT_PUBLIC_API_URL'] = 'https://api.example.test';
    expect(getApiUrl()).toBe(BROWSER_API_BASE);
  });

  it('is same-origin with no env var at all', () => {
    delete process.env['NEXT_PUBLIC_API_URL'];
    expect(getApiUrl()).toBe(BROWSER_API_BASE);
  });
});

describe('getApiUrl on the server', () => {
  beforeEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('returns the configured URL', () => {
    process.env['NEXT_PUBLIC_API_URL'] = 'https://api.example.test';
    expect(getApiUrl()).toBe('https://api.example.test');
  });

  it('falls back to the local API when unset', () => {
    delete process.env['NEXT_PUBLIC_API_URL'];
    expect(getApiUrl()).toBe('http://localhost:4000');
  });

  it('treats an empty or whitespace value as unset', () => {
    // next.config's REQUIRED_PROD_ENV already rejects '' (it is falsy), so the
    // value this guard actually catches is whitespace — truthy enough to pass
    // that check, and enough to defeat a bare `??`.
    process.env['NEXT_PUBLIC_API_URL'] = '';
    expect(getApiUrl()).toBe('http://localhost:4000');
    process.env['NEXT_PUBLIC_API_URL'] = '   ';
    expect(getApiUrl()).toBe('http://localhost:4000');
  });

  it('trims surrounding whitespace from a real value', () => {
    process.env['NEXT_PUBLIC_API_URL'] = '  https://api.example.test  ';
    expect(getApiUrl()).toBe('https://api.example.test');
  });
});
