import { describe, expect, it } from 'vitest';
import { __testing, runOnePerEvent } from './one-write-per-event';

/** A promise the test settles by hand. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, bad) => {
    resolve = ok;
    reject = bad;
  });
  return { promise, resolve, reject };
}

/** Lets every pending promise callback run. */
const settle = () => new Promise((ok) => setTimeout(ok, 0));

describe('runOnePerEvent', () => {
  it('runs a second write of the same Event only after the first settled', async () => {
    const order: string[] = [];
    const first = deferred<string>();
    const a = runOnePerEvent('fal', () => {
      order.push('a starts');
      return first.promise;
    });
    const b = runOnePerEvent('fal', () => {
      order.push('b starts');
      return Promise.resolve('b');
    });
    await settle();
    expect(order).toEqual(['a starts']);
    first.resolve('a');
    expect(await a).toBe('a');
    expect(await b).toBe('b');
    expect(order).toEqual(['a starts', 'b starts']);
  });

  it('runs the next write after a rejection, and hands the rejection to its own caller', async () => {
    const first = deferred();
    const a = runOnePerEvent('fal', () => first.promise);
    const b = runOnePerEvent('fal', () => Promise.resolve('b'));
    first.reject(new Error('write failed'));
    await expect(a).rejects.toThrow('write failed');
    expect(await b).toBe('b');
  });

  it('runs the next write after a function that throws before it returns a promise', async () => {
    const a = runOnePerEvent('fal', () => {
      throw new Error('bad input');
    });
    await expect(a).rejects.toThrow('bad input');
    expect(await runOnePerEvent('fal', () => Promise.resolve('b'))).toBe('b');
  });

  it('runs writes of two Events at once', async () => {
    const first = deferred<string>();
    const a = runOnePerEvent('fal', () => first.promise);
    let otherRan = false;
    const b = runOnePerEvent('open-de-lyon', () => {
      otherRan = true;
      return Promise.resolve('b');
    });
    expect(await b).toBe('b');
    expect(otherRan).toBe(true);
    first.resolve('a');
    expect(await a).toBe('a');
  });

  it('forgets an Event once its last write settled', async () => {
    const first = deferred();
    const a = runOnePerEvent('fal', () => first.promise);
    const b = runOnePerEvent('fal', () => Promise.resolve());
    const c = runOnePerEvent('open-de-lyon', () => Promise.reject(new Error('no')));
    expect(__testing.size()).toBe(2);
    first.resolve();
    await Promise.all([a, b, c.catch(() => undefined)]);
    await settle();
    expect(__testing.size()).toBe(0);
  });
});
