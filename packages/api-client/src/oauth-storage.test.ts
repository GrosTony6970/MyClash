import { describe, expect, it, vi } from 'vitest';
import { OAUTH_STORAGE_KEY, oauthClientOptions, oauthVerifierStorage } from './oauth-storage';
import type { CookieJar } from './oauth-storage';

/** A browser cookie jar in miniature: it applies each written cookie as `document.cookie` does. */
function fakeJar(secure = false, initial: Record<string, string> = {}) {
  const cookies = new Map(Object.entries(initial));
  const writes: string[] = [];
  const jar: CookieJar = {
    secure,
    read: () => [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
    write: (cookie) => {
      writes.push(cookie);
      const [pair = '', ...attributes] = cookie.split('; ');
      const at = pair.indexOf('=');
      const name = pair.slice(0, at);
      if (attributes.includes('Max-Age=0')) cookies.delete(name);
      else cookies.set(name, pair.slice(at + 1));
    },
  };
  return { jar, writes };
}

const SLOT = 'mc-oauth-flow-ab12cd34-code-verifier';

describe('oauthVerifierStorage', () => {
  it('keeps a code verifier in a one-hour cookie', () => {
    const { jar, writes } = fakeJar();
    const storage = oauthVerifierStorage(jar);
    storage.setItem(SLOT, '"v1"');
    storage.setItem('mc-oauth-flows-code-verifier', '["ab12cd34"]');

    expect(writes[0]).toBe(`${SLOT}=%22v1%22; Max-Age=3600; Path=/; SameSite=Lax`);
    expect(storage.getItem(SLOT)).toBe('"v1"');
    expect(storage.getItem('mc-oauth-flows-code-verifier')).toBe('["ab12cd34"]');
  });

  it('marks the cookie Secure on https', () => {
    const { jar, writes } = fakeJar(true);
    oauthVerifierStorage(jar).setItem(SLOT, '"v1"');
    expect(writes[0]).toBe(`${SLOT}=%22v1%22; Max-Age=3600; Path=/; SameSite=Lax; Secure`);
  });

  it('reads a cookie by its exact name', () => {
    const { jar } = fakeJar(false, {
      'mc-oauth-flows-code-verifier': 'index',
      'mc-oauth-code-verifier': 'fixed',
    });
    expect(oauthVerifierStorage(jar).getItem('mc-oauth-code-verifier')).toBe('fixed');
  });

  it('a broken cookie reads as none', () => {
    const { jar } = fakeJar(false, { 'mc-oauth-code-verifier': '%E0%A4%A' });
    expect(oauthVerifierStorage(jar).getItem('mc-oauth-code-verifier')).toBeNull();
  });

  it('writes nothing for the login or the user', () => {
    const { jar, writes } = fakeJar();
    const storage = oauthVerifierStorage(jar);
    storage.setItem('mc-oauth', '{"access_token":"t"}');
    storage.setItem('mc-oauth-user', '{}');
    storage.setItem('mc-oauth-session', 'x');

    expect(writes).toEqual([]);
    expect(storage.getItem('mc-oauth')).toBeNull();
  });

  it('keeps nothing under another storage key', () => {
    const { jar, writes } = fakeJar();
    oauthVerifierStorage(jar).setItem('sb-app-auth-token-code-verifier', 'v');
    expect(writes).toEqual([]);
  });

  it('removing a verifier expires its cookie', () => {
    const { jar, writes } = fakeJar();
    const storage = oauthVerifierStorage(jar);
    storage.setItem(SLOT, '"v1"');
    storage.removeItem(SLOT);

    expect(writes[1]).toBe(`${SLOT}=; Max-Age=0; Path=/; SameSite=Lax`);
    expect(storage.getItem(SLOT)).toBeNull();
  });

  it('a value is encoded', () => {
    const { jar } = fakeJar();
    const storage = oauthVerifierStorage(jar);
    storage.setItem(SLOT, 'a; b=c d');
    expect(jar.read()).not.toContain('a; b');
    expect(storage.getItem(SLOT)).toBe('a; b=c d');
  });

  it('without a document it does nothing', () => {
    const storage = oauthVerifierStorage(null);
    expect(() => storage.setItem(SLOT, 'v')).not.toThrow();
    expect(() => storage.removeItem(SLOT)).not.toThrow();
    expect(storage.getItem(SLOT)).toBeNull();
  });

  it.each([
    ['https:', '; Secure'],
    ['http:', ''],
  ])('the page cookie jar marks Secure from the page address (%s)', (protocol, secure) => {
    const written: string[] = [];
    vi.stubGlobal('location', { protocol });
    vi.stubGlobal('document', {
      get cookie() {
        return '';
      },
      set cookie(value: string) {
        written.push(value);
      },
    });
    try {
      oauthVerifierStorage().setItem(SLOT, '"v1"');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(written).toEqual([`${SLOT}=%22v1%22; Max-Age=3600; Path=/; SameSite=Lax${secure}`]);
  });

  it('with no jar given and no document, the default jar is none', () => {
    expect(typeof document).toBe('undefined');
    const storage = oauthVerifierStorage();
    expect(() => storage.setItem(SLOT, 'v')).not.toThrow();
    expect(storage.getItem(SLOT)).toBeNull();
  });
});

describe('oauthClientOptions', () => {
  it('keeps the login out of storage and the check in a cookie', () => {
    const { auth } = oauthClientOptions();
    expect(OAUTH_STORAGE_KEY).toBe('mc-oauth');
    expect(auth).toMatchObject({
      storageKey: 'mc-oauth',
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'pkce',
      experimental: { appendPkceFlowIdToRedirects: true },
    });
    expect(typeof auth.storage.getItem).toBe('function');
  });
});
