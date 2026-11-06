/**
 * Where the Google sign-in keeps its one-time check, and nothing else.
 *
 * A Google sign-in (PKCE) needs one value to survive the trip to Google and back: the code
 * verifier, written before leaving and read by the callback page. The login itself goes to
 * our server, which keeps it in its own httpOnly cookies. Supabase's client writes both
 * through the same `storage`, so this storage keeps only the verifier keys, in a cookie that
 * lasts one hour and is expired once used, and drops every other key: the session, the user.
 * The login is never stored where a page script could read it. It is still in memory on the
 * callback page, which sends it to our server, and auth-js announces it once to the site's
 * other open tabs (`BroadcastChannel('mc-oauth')`); neither stores it.
 *
 * A sign-in abandoned at Google never reaches the exchange, so its check cookies stay until
 * their hour ends. They hold a random check, not a login: that hour is the clean-up.
 *
 * Both apps build their Google client from `oauthClientOptions()`, so they cannot drift.
 * web-admin's check moved from `localStorage` to a cookie only so both apps share this one
 * storage: a host-only cookie reaches no further than `localStorage`.
 */

export const OAUTH_STORAGE_KEY = 'mc-oauth';

const VERIFIER_SUFFIX = '-code-verifier';
const ATTRIBUTES = 'Path=/; SameSite=Lax';
const ONE_HOUR = 3600;

export interface CookieJar {
  read(): string;
  write(cookie: string): void;
  secure: boolean;
}

function documentJar(): CookieJar | null {
  if (typeof document === 'undefined') return null;
  return {
    read: () => document.cookie,
    write: (cookie) => {
      document.cookie = cookie;
    },
    secure: typeof location !== 'undefined' && location.protocol === 'https:',
  };
}

/** Only auth-js's verifier keys under our storage key: the slot, the index, the fixed key. */
function isVerifierKey(key: string): boolean {
  return key.startsWith(`${OAUTH_STORAGE_KEY}-`) && key.endsWith(VERIFIER_SUFFIX);
}

function readCookie(jar: CookieJar, name: string): string | null {
  for (const pair of jar.read().split('; ')) {
    const at = pair.indexOf('=');
    if (at < 0 || pair.slice(0, at) !== name) continue;
    try {
      return decodeURIComponent(pair.slice(at + 1));
    } catch {
      // A value we did not write. The exchange reads it outside its own `try`, so a
      // throw here would surface as a crash rather than "no check found".
      return null;
    }
  }
  return null;
}

function writeCookie(jar: CookieJar, name: string, value: string, maxAge: number): void {
  const secure = jar.secure ? '; Secure' : '';
  jar.write(`${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; ${ATTRIBUTES}${secure}`);
}

export function oauthVerifierStorage(jar: CookieJar | null = documentJar()) {
  return {
    getItem(key: string): string | null {
      return jar && isVerifierKey(key) ? readCookie(jar, key) : null;
    },
    setItem(key: string, value: string): void {
      if (jar && isVerifierKey(key)) writeCookie(jar, key, value, ONE_HOUR);
    },
    removeItem(key: string): void {
      if (jar && isVerifierKey(key)) writeCookie(jar, key, '', 0);
    },
  };
}

/**
 * The auth options of a Google sign-in client: spread into `createClient(url, key, …)`.
 *
 * `persistSession` stays on so the verifier is written at all; the storage drops the
 * session. `appendPkceFlowIdToRedirects` puts the sign-in's id on the return address, so
 * the exchange deletes every verifier key it wrote, not only the fixed one.
 */
export function oauthClientOptions() {
  return {
    auth: {
      storageKey: OAUTH_STORAGE_KEY,
      storage: oauthVerifierStorage(),
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'pkce' as const,
      experimental: { appendPkceFlowIdToRedirects: true },
    },
  };
}
