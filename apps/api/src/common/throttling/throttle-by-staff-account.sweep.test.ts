import { describe, expect, it } from 'vitest';
import { STAFF_PIN_THROTTLE } from './throttle-profiles';
import { SWEEP_ABOVE, SWEEP_EVERY_MS, triesOf, type TryStore } from './throttle-by-staff-account';

/**
 * The wrong-PIN count's memory (O3). Above SWEEP_ABOVE accounts, the ones whose hour is over are
 * swept, at most once a minute: a sweep on every try scanned the whole store on each sign-in.
 */
const T0 = 1_000_000_000;
const AN_HOUR_LATER = T0 + STAFF_PIN_THROTTLE.ttl + 1;

/** A store over the bound, every account with one wrong PIN at T0. */
function crowded(): TryStore {
  const byBucket = new Map<string, number[]>();
  for (let i = 0; i <= SWEEP_ABOVE; i++) byBucket.set(`old-${i}`, [T0]);
  return { byBucket, sweptAt: 0 };
}

describe('triesOf — the accounts whose hour is over', () => {
  it('are swept once the store holds more than the bound', () => {
    const store = crowded();

    triesOf(store, 'new', AN_HOUR_LATER);

    expect([...store.byBucket.keys()]).toEqual(['new']);
  });

  it('are swept at most once a minute', () => {
    const store = crowded();
    triesOf(store, 'new', AN_HOUR_LATER);
    for (let i = 0; i <= SWEEP_ABOVE; i++) store.byBucket.set(`later-${i}`, [T0]);

    triesOf(store, 'new', AN_HOUR_LATER + SWEEP_EVERY_MS - 1);
    expect(store.byBucket.size).toBe(SWEEP_ABOVE + 2);

    triesOf(store, 'new', AN_HOUR_LATER + SWEEP_EVERY_MS);
    expect([...store.byBucket.keys()]).toEqual(['new']);
  });

  it('keeps an account still inside its hour', () => {
    const store = crowded();
    store.byBucket.set('recent', [AN_HOUR_LATER - 1]);

    triesOf(store, 'new', AN_HOUR_LATER);

    expect([...store.byBucket.keys()].sort()).toEqual(['new', 'recent']);
  });
});
