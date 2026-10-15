import { describe, expect, it } from 'vitest';
import { ticksAfterBulk } from './bulk-ticks';

/**
 * Ruled 2026-10-15: ten ticked, two more ticked while the bulk action runs, three refused. The
 * three refused stay ticked, and so do the two added while it ran; the seven it did are not.
 */
const set = (...ids: string[]) => new Set(ids);

describe('ticksAfterBulk', () => {
  it('keeps the refused and the ones ticked while it ran', () => {
    const batch = set('a', 'b', 'c');
    const now = set('a', 'b', 'c', 'd');
    expect([...ticksAfterBulk(now, batch, set('b'))].sort()).toEqual(['b', 'd']);
  });

  it('keeps a refused one even if it was unticked while it ran: the next press retries it', () => {
    expect([...ticksAfterBulk(set('a'), set('a', 'b'), set('b'))]).toEqual(['b']);
  });

  it('unticks everything it did when nothing was refused or added', () => {
    expect(ticksAfterBulk(set('a', 'b'), set('a', 'b'), set()).size).toBe(0);
  });
});
