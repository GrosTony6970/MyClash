import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A fresh module for each test: the choice kept in memory is module state. */
async function mirrorModule() {
  vi.resetModules();
  return import('./useDisplayMirror.js');
}

/** A browser's storage that keeps what it is given. */
function storage(initial: Record<string, string> = {}) {
  const kept = new Map(Object.entries(initial));
  return {
    kept,
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
  };
}

/** A browser that refuses its storage, as a private window does. */
const refused = {
  getItem: () => {
    throw new Error('refused');
  },
  setItem: () => {
    throw new Error('refused');
  },
};

describe('swap sides — the choice of a TV screen', () => {
  let mirror: Awaited<ReturnType<typeof mirrorModule>>;
  beforeEach(async () => {
    mirror = await mirrorModule();
  });

  it('a screen where nothing was chosen takes its own default', () => {
    expect(mirror.mirrorOf(mirror.readMirror(storage()), true)).toBe(true);
    expect(mirror.mirrorOf(mirror.readMirror(storage()), false)).toBe(false);
  });

  it('a choice wins over the default, both ways', () => {
    const off = storage({ [mirror.MIRROR_STORAGE_KEY]: 'false' });
    const on = storage({ [mirror.MIRROR_STORAGE_KEY]: 'true' });
    expect(mirror.mirrorOf(mirror.readMirror(off), true)).toBe(false);
    expect(mirror.mirrorOf(mirror.readMirror(on), false)).toBe(true);
  });

  it('a choice is written under the one key, and read back', () => {
    const store = storage();
    mirror.writeMirror(store, true);
    expect([...store.kept]).toEqual([['myclash:display:mirror', 'true']]);
    expect(mirror.readMirror(store)).toBe('true');
  });

  it('a browser that refuses its storage still swaps, from memory', () => {
    expect(mirror.readMirror(refused)).toBeNull();
    mirror.writeMirror(refused, true);
    expect(mirror.mirrorOf(mirror.readMirror(refused), false)).toBe(true);
  });

  it('with no browser at all (the server), nothing was chosen', () => {
    expect(mirror.readMirror(null)).toBeNull();
  });
});
