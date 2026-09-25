import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filtersFor, mockSupabase, selectsFor } from './testing/supabase-chain';
import { isFlagEnabledDirect } from './feature-flag-direct';

/**
 * The direct kill-switch read (operator ruling 109a). A failed read means
 * "switch OFF, keep working" — a kill switch is off almost always, and reading a
 * blip as ON would drop a sign-in email without a trace — and it LEAVES A TRACE:
 * a returned `error` and a throw both log a warning naming the flag.
 *
 * Until 2026-09-25 the returned `error` was ignored and nothing was logged, while
 * the docstring said "fails closed".
 */
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => warn.mockRestore());

const read = (seed: Parameters<typeof mockSupabase>[0]) => {
  const db = mockSupabase(seed);
  return { db, value: isFlagEnabledDirect(db as never, 'disable_email') };
};

describe('isFlagEnabledDirect (ruling 109a)', () => {
  it('reads the switch it is asked for', async () => {
    const { db, value } = read({
      feature_flags: {
        rows: [
          { key: 'disable_signups', enabled: true },
          { key: 'disable_email', enabled: false },
        ],
      },
    });
    await expect(value).resolves.toBe(false);
    expect(selectsFor(db.from, 'feature_flags')).toEqual(['enabled']);
    expect(filtersFor(db.from, 'feature_flags', 'eq')).toEqual([['key', 'disable_email']]);
  });

  it('answers ON when the switch is on', async () => {
    const { value } = read({ feature_flags: { rows: [{ key: 'disable_email', enabled: true }] } });
    await expect(value).resolves.toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('answers OFF, silently, when the switch has no row', async () => {
    const { value } = read({ feature_flags: { rows: [] } });
    await expect(value).resolves.toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('answers OFF on a failed read, and leaves a trace', async () => {
    const { value } = read({ feature_flags: { data: null, error: { message: 'timeout' } } });
    await expect(value).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/disable_email.*timeout/u));
  });

  it('answers OFF when the read throws, and leaves a trace', async () => {
    const db = {
      service: {
        from: () => {
          throw new Error('socket hang up');
        },
      },
    };
    await expect(isFlagEnabledDirect(db as never, 'disable_email')).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/disable_email.*socket hang up/u));
  });
});
