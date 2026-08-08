import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearStoredPass, readStoredPass, writeStoredPass } from './event-pass';

const SLUG = 'fal-2026';

/**
 * These tests run in vitest's `node` environment (this app has no jsdom), so
 * `window` is stubbed the same way `api-url.test.ts` does it. A real Storage is
 * not needed — only its three methods are, and using a Map makes the
 * throw-on-access branch easy to reach.
 */
let store: Map<string, string>;
let originalWindow: unknown;

function stubWindow(storage: Partial<Storage>) {
  (globalThis as { window?: unknown }).window = { localStorage: storage } as unknown as Window;
}

beforeEach(() => {
  originalWindow = (globalThis as { window?: unknown }).window;
  store = new Map();
  stubWindow({
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
});

afterEach(() => {
  if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = originalWindow;
});

describe('event pass storage', () => {
  it('round-trips a pass, so the QR renders with no network', () => {
    // The whole point: a sports hall with no signal is the only place this is
    // ever presented.
    writeStoredPass(SLUG, { token: 'tok-abc', expiresAt: null });

    expect(readStoredPass(SLUG)).toEqual({ token: 'tok-abc', expiresAt: null });
  });

  it('keeps passes for different events apart', () => {
    // `persons` is event-scoped, so the same human holds a different pass at
    // every event. One key would silently present the wrong one.
    writeStoredPass(SLUG, { token: 'tok-fal', expiresAt: null });
    writeStoredPass('open-de-bretagne', { token: 'tok-odb', expiresAt: null });

    expect(readStoredPass(SLUG)?.token).toBe('tok-fal');
    expect(readStoredPass('open-de-bretagne')?.token).toBe('tok-odb');
  });

  it('returns null when this device holds no pass', () => {
    expect(readStoredPass(SLUG)).toBeNull();
  });

  it('drops an expired pass instead of rendering a QR the desk will refuse', () => {
    // Finding out at the desk with a queue behind you is worse than finding out
    // on the way in.
    writeStoredPass(SLUG, { token: 'tok-old', expiresAt: '2020-01-01T00:00:00.000Z' });

    expect(readStoredPass(SLUG)).toBeNull();
    expect(store.has(`mc_event_pass:${SLUG}`)).toBe(false);
  });

  it('keeps a pass that has not expired yet', () => {
    writeStoredPass(SLUG, { token: 'tok-live', expiresAt: '2026-08-16T00:00:00.000Z' });

    expect(readStoredPass(SLUG, Date.parse('2026-08-09T10:00:00.000Z'))?.token).toBe('tok-live');
  });

  it('treats a malformed entry as absent, so an old build re-issues', () => {
    store.set(`mc_event_pass:${SLUG}`, 'not json');
    expect(readStoredPass(SLUG)).toBeNull();

    store.set(`mc_event_pass:${SLUG}`, JSON.stringify({ nope: 1 }));
    expect(readStoredPass(SLUG)).toBeNull();
  });

  it('survives storage that throws — Safari private mode does', () => {
    stubWindow({
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    });

    // A worse pass, not a broken page.
    expect(readStoredPass(SLUG)).toBeNull();
    expect(() => writeStoredPass(SLUG, { token: 'tok', expiresAt: null })).not.toThrow();
  });

  it('is inert during SSR, where there is no window at all', () => {
    delete (globalThis as { window?: unknown }).window;

    expect(readStoredPass(SLUG)).toBeNull();
    expect(() => writeStoredPass(SLUG, { token: 'tok', expiresAt: null })).not.toThrow();
    expect(() => clearStoredPass(SLUG)).not.toThrow();
  });

  it('clears on request', () => {
    writeStoredPass(SLUG, { token: 'tok', expiresAt: null });
    clearStoredPass(SLUG);

    expect(readStoredPass(SLUG)).toBeNull();
  });
});
