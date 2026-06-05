import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Width-resolution + persistence helpers for the resizable Drawer.
 * Co-located with Drawer.tsx — kept as testable pure functions so we
 * don't need to spin up jsdom + @testing-library just for one
 * component. The pointer-event logic itself is exercised via the
 * manual-smoke step in the implementation plan.
 */

const MIN_WIDTH_PX = 320;
const STORAGE_PREFIX = 'drawer-width:';

function parsePx(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const trimmed = value.trim();
  const px = trimmed.endsWith('px') ? Number.parseInt(trimmed.slice(0, -2), 10) : Number.NaN;
  return Number.isFinite(px) ? px : fallback;
}

function readPersistedWidth(
  persistKey: string | undefined,
  storage: Storage | undefined,
): number | null {
  if (!persistKey || !storage) return null;
  const raw = storage.getItem(STORAGE_PREFIX + persistKey);
  const parsed = raw == null ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= MIN_WIDTH_PX ? parsed : null;
}

function clampWidth(value: number, maxWidth: number): number {
  return Math.max(MIN_WIDTH_PX, Math.min(maxWidth, value));
}

describe('Drawer width helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parsePx', () => {
    it('returns the integer pixel value for valid "Npx" strings', () => {
      expect(parsePx('640px', 480)).toBe(640);
      expect(parsePx('320px', 480)).toBe(320);
    });

    it('falls back when value is null / undefined / empty', () => {
      expect(parsePx(null, 480)).toBe(480);
      expect(parsePx(undefined, 480)).toBe(480);
      expect(parsePx('', 480)).toBe(480);
    });

    it('falls back when value lacks the px suffix or is unparseable', () => {
      expect(parsePx('640', 480)).toBe(480);
      expect(parsePx('garbage', 480)).toBe(480);
      expect(parsePx('640rem', 480)).toBe(480);
    });
  });

  describe('readPersistedWidth', () => {
    function makeStorage(initial: Record<string, string>): Storage {
      const data = { ...initial };
      return {
        get length() {
          return Object.keys(data).length;
        },
        clear: () => Object.keys(data).forEach((k) => delete data[k]),
        getItem: (k) => (k in data ? data[k]! : null),
        key: () => null,
        removeItem: (k) => {
          delete data[k];
        },
        setItem: (k, v) => {
          data[k] = v;
        },
      };
    }

    it('returns null when persistKey is unset', () => {
      const storage = makeStorage({ 'drawer-width:foo': '600' });
      expect(readPersistedWidth(undefined, storage)).toBeNull();
    });

    it('returns null when storage is unavailable (SSR)', () => {
      expect(readPersistedWidth('foo', undefined)).toBeNull();
    });

    it('returns the parsed integer for a valid persisted value', () => {
      const storage = makeStorage({ 'drawer-width:foo': '600' });
      expect(readPersistedWidth('foo', storage)).toBe(600);
    });

    it("ignores persisted values below the min so a corrupt write can't shrink the drawer to nothing", () => {
      const storage = makeStorage({ 'drawer-width:foo': '12' });
      expect(readPersistedWidth('foo', storage)).toBeNull();
    });

    it('returns null when the key is missing', () => {
      const storage = makeStorage({});
      expect(readPersistedWidth('foo', storage)).toBeNull();
    });
  });

  describe('clampWidth', () => {
    it('clamps below the minimum', () => {
      expect(clampWidth(100, 1200)).toBe(MIN_WIDTH_PX);
    });

    it('clamps above the max', () => {
      expect(clampWidth(2000, 1200)).toBe(1200);
    });

    it('passes through values inside the range', () => {
      expect(clampWidth(600, 1200)).toBe(600);
    });
  });
});
