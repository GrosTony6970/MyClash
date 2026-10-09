import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeHit } from './useScoringSubmit';

/**
 * A hit the tablet could not write down says so.
 *
 * The official taps +1 and the tablet's own store refuses the write (it is
 * full, or the browser closed it). The error was kept in a state nothing read:
 * the screen said nothing, the score did not move, and he found out later
 * that the point was never recorded.
 */
afterEach(() => vi.restoreAllMocks());

describe('writeHit', () => {
  it('asks for a send and moves the sequence on once the hit is on the tablet', async () => {
    const order: string[] = [];
    const written = await writeHit(
      async () => void order.push('written'),
      { sendBehind: () => void order.push('send asked') },
      () => void order.push('sequence moved'),
    );
    expect(written).toBe('saved');
    expect(order).toEqual(['written', 'send asked', 'sequence moved']);
  });

  it('counts nothing and sends nothing when the tablet could not write the hit', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sendBehind = vi.fn();
    const moved = vi.fn();
    const refused = new Error('QuotaExceededError');
    const written = await writeHit(
      async () => {
        throw refused;
      },
      { sendBehind },
      moved,
    );
    expect(written).toBe('not_saved');
    expect(sendBehind).not.toHaveBeenCalled();
    expect(moved).not.toHaveBeenCalled();
    // The store's own words go to the console, never to the official.
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('[pad]'), refused);
  });

  it('saves with no engine and no listener', async () => {
    expect(await writeHit(async () => {}, null, undefined)).toBe('saved');
  });
});

describe('the bout screen', () => {
  const read = (...path: string[]) => readFileSync(join(__dirname, '..', ...path), 'utf8');
  const hook = read('hooks', 'useScoringSubmit.ts');
  const controls = read('components', 'ScoringCenterControls.tsx');

  it('holds what the last write said: one writer, so a written press clears it', () => {
    expect(hook).toContain('const written = await writeHit(');
    expect(hook.match(/setNotSaved\(/g)).toHaveLength(1);
    expect(hook).toContain("setNotSaved(written === 'not_saved');");
  });

  it('never shows the store’s own words', () => {
    expect(hook).not.toContain('err.message');
    expect(hook).not.toContain('Failed to record exchange');
  });

  it('says it as an alert beside the clock, in the reader’s language', () => {
    expect(controls).toMatch(
      /\{submit\.notSaved && \(\s+<p\s+role="alert"[^>]*>\s+\{t\('scoring\.lice\.hitNotSaved'\)\}/,
    );
  });
});
