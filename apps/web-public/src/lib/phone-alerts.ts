/**
 * This browser's phone alert address, and the account it rings for (operator ruling 238).
 *
 * A browser holds ONE push address, whoever is signed in. Anna turned alerts on at the club's
 * laptop and signed out; Ben signed in. The browser kept Anna's address and the server kept it
 * under her account, so her alerts showed while Ben used the laptop, and Ben's settings page said
 * "Enabled" because it asked the browser alone.
 *
 * So the server is asked whose the address is; a sign-out, and a deleted account, take the
 * address out of the browser; and a personal space checks it at each visit. A pure module: this
 * package's vitest does not compile TSX, so what can be tested is kept out of the components.
 */
import { apiRequest } from '@myclash/api-client';

/**
 * The address this browser holds, or null. Null is also the answer of a browser with no push, or
 * with no worker yet: `/sw.js` is registered by the alert settings page alone, so
 * `serviceWorker.ready` would wait for ever here.
 */
export async function browserAddress(): Promise<PushSubscription | null> {
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** Takes the address out of the browser. False when the browser refused. */
async function forget(address: PushSubscription): Promise<boolean> {
  try {
    return await address.unsubscribe();
  } catch {
    return false;
  }
}

/** `unknown`: nobody could say (offline, a failed read). `signed-out`: the login is over. */
export type Saved = 'yes' | 'no' | 'signed-out' | 'unknown';

/**
 * Is that address saved for the signed-in account? Only the server's own "no" is a `no`: on
 * `no` the browser drops the address.
 */
export async function savedForMe(apiUrl: string, endpoint: string): Promise<Saved> {
  const result = await apiRequest<{ subscribed: boolean }>(
    apiUrl,
    '/api/v1/notifications/me/subscribed',
    { method: 'POST', body: { endpoint } },
  );
  if (result.ok) return result.data.subscribed ? 'yes' : 'no';
  return result.kind === 'unauthenticated' ? 'signed-out' : 'unknown';
}

async function check(apiUrl: string): Promise<void> {
  const held = await browserAddress();
  if (!held || (await savedForMe(apiUrl, held.endpoint)) !== 'no') return;
  // The answer is about the address that was asked. Another tab may have turned alerts on again
  // meanwhile, under a new address: that one stays.
  const now = await browserAddress();
  if (now?.endpoint === held.endpoint) await forget(now);
}

let checking: Promise<void> | null = null;

/**
 * An address in this browser that is not the signed-in account's goes out of the browser. Only
 * the check in flight is shared, never its answer: a sign-in does not reload the page, and the
 * next account must be asked again. "Turn on" waits for it, because an answer that lands after a
 * fresh save would drop the address just saved.
 */
export function dropForeignAddress(apiUrl: string): Promise<void> {
  checking ??= check(apiUrl).finally(() => {
    checking = null;
  });
  return checking;
}

/**
 * Turns phone alerts off in this browser. The browser first: an address it gave up is dead, and
 * a dead address is removed at the next alert even when the request below is lost. False when
 * the browser kept its address.
 */
export async function turnOffPhoneAlerts(apiUrl: string): Promise<boolean> {
  const held = await browserAddress();
  if (!held) return true;
  const gone = await forget(held);
  await apiRequest<unknown>(apiUrl, '/api/v1/notifications/me/unsubscribe', {
    method: 'POST',
    body: { endpoint: held.endpoint },
  });
  return gone;
}

/**
 * Leaves the page of an account that was just deleted. Its saved addresses went with it; the
 * browser's own copy goes here, before the page changes.
 */
export async function leaveDeletedAccount(to: string): Promise<void> {
  const held = await browserAddress();
  if (held) await forget(held);
  window.location.replace(to);
}

/**
 * The ONE sign-out of this app. The alerts go first, while the login can still say whose address
 * it is; then the login; then the page. Nothing here throws, so the page always changes.
 */
export async function signOut(apiUrl: string, to: string): Promise<void> {
  await turnOffPhoneAlerts(apiUrl);
  await apiRequest<unknown>(apiUrl, '/api/v1/auth/logout', { method: 'POST' });
  window.location.assign(to);
}
