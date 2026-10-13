import { describe, expect, it } from 'vitest';
import { firstRenewalHere } from './renewed-here';

/** One more load after a renewed login, never a loop (the not-found page). */
function tabStore(broken = false) {
  const held = new Map<string, string>();
  return {
    held,
    getItem: (key: string) => {
      if (broken) throw new Error('site data is blocked');
      return held.get(key) ?? null;
    },
    setItem: (key: string, value: string) => void held.set(key, value),
    removeItem: (key: string) => void held.delete(key),
  };
}

describe('the page is loaded again once after a renewed login', () => {
  it('the first time: yes. The second time at the same address: no', () => {
    const store = tabStore();
    expect(firstRenewalHere('/e/draft/home', store)).toBe(true);
    expect(firstRenewalHere('/e/draft/home', store)).toBe(false);
  });

  it('a later visit to that address starts again', () => {
    const store = tabStore();
    firstRenewalHere('/e/draft/home', store);
    firstRenewalHere('/e/draft/home', store);
    expect(store.held.size).toBe(0);
    expect(firstRenewalHere('/e/draft/home', store)).toBe(true);
  });

  it('another address is its own first time', () => {
    const store = tabStore();
    firstRenewalHere('/e/draft/home', store);
    expect(firstRenewalHere('/e/draft/tournaments', store)).toBe(true);
  });

  it('a browser that keeps nothing never loads again', () => {
    expect(firstRenewalHere('/e/draft/home', null)).toBe(false);
    expect(firstRenewalHere('/e/draft/home', tabStore(true))).toBe(false);
  });
});
