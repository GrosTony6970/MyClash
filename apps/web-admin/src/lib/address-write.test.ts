import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forgetLanded, writeAddress } from './address-write';

/**
 * Two hooks write an Event page's address: its Tournament and a list's filters. A
 * `router.replace` lands a round trip later, and each built on the address as it was: a
 * Tournament switched while a filter write was out dropped the filter from the address.
 */
const written: string[] = [];
const replace = (href: string) => void written.push(href);
const at = (href: string) => window.history.replaceState(null, '', href);

beforeEach(() => {
  written.length = 0;
  at('/org/club/events/ev1/persons?tournamentId=t1#list');
});
afterEach(() => at('/'));

describe('writeAddress', () => {
  it('keeps a filter still being written when the Tournament changes', () => {
    writeAddress(replace, { q: 'lea' });
    writeAddress(replace, { tournamentId: 't2' });
    expect(written).toEqual([
      '/org/club/events/ev1/persons?tournamentId=t1&q=lea#list',
      '/org/club/events/ev1/persons?tournamentId=t2&q=lea#list',
    ]);
  });

  it('removes a filter set back to its default, and keeps that while it is out', () => {
    at('/org/club/events/ev1/persons?tournamentId=t1&q=lea#list');
    writeAddress(replace, { q: null });
    writeAddress(replace, { tournamentId: 't2' });
    expect(written.at(-1)).toBe('/org/club/events/ev1/persons?tournamentId=t2#list');
  });

  it('forgets a write once the address shows it: a link after it speaks for itself', () => {
    writeAddress(replace, { q: 'lea' });
    at('/org/club/events/ev1/persons?tournamentId=t1&q=lea#list'); // it landed
    forgetLanded(); // as each writing hook does when the address moves
    at('/org/club/events/ev1/persons?tournamentId=t3#list'); // a link with no filter
    forgetLanded();
    writeAddress(replace, { tournamentId: 't2' });
    expect(written.at(-1)).toBe('/org/club/events/ev1/persons?tournamentId=t2#list');
  });

  it('forgets a write meant for another page', () => {
    writeAddress(replace, { q: 'lea' });
    at('/org/club/events/ev1/pools?tournamentId=t1#matches');
    writeAddress(replace, { tournamentId: 't2' });
    expect(written.at(-1)).toBe('/org/club/events/ev1/pools?tournamentId=t2#matches');
  });
});
