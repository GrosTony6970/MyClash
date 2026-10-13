/**
 * "This page was loaded again once, after its login was renewed": the note the
 * not-found page leaves before it loads the page again, and reads after.
 *
 * It stops a loop. The server decides "this login ended" by its own clock, and
 * `/me` by another: if they disagree, `/me` says the login is good, renews
 * nothing, and the page loaded again is "not found" again. One more load, then
 * the page says so.
 *
 * Kept for the tab only. A browser that blocks site data keeps nothing: it
 * reads as "already loaded again", so such a browser never loads twice.
 */
const KEY = 'myclash:renewed-here';

type TabStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function tabStore(): TabStore | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * True the first time it is asked for this address, and it notes the address.
 * False the next time, and it removes the note: a later visit starts again.
 */
export function firstRenewalHere(path: string, store: TabStore | null = tabStore()): boolean {
  try {
    if (!store) return false;
    if (store.getItem(KEY) === path) {
      store.removeItem(KEY);
      return false;
    }
    store.setItem(KEY, path);
    return true;
  } catch {
    return false;
  }
}
