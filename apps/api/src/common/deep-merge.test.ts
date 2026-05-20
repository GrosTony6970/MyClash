import { describe, expect, it } from 'vitest';
import { deepMergeJson } from './deep-merge';

describe('deepMergeJson', () => {
  it('merges nested objects key-by-key, preserving unrelated keys', () => {
    const base = { winBonus: 3, targetValues: { deepTarget: 2, shallowTarget: 1 } };
    const patch = { winBonus: 5 };
    expect(deepMergeJson(base, patch)).toEqual({
      winBonus: 5,
      targetValues: { deepTarget: 2, shallowTarget: 1 },
    });
  });

  it('replaces arrays atomically (no concat)', () => {
    const base = { buttons: [{ label: 'A' }, { label: 'B' }] };
    const patch = { buttons: [{ label: 'C' }] };
    expect(deepMergeJson(base, patch)).toEqual({ buttons: [{ label: 'C' }] });
  });

  it('returns patch when base is null/undefined', () => {
    expect(deepMergeJson(null, { a: 1 })).toEqual({ a: 1 });
    expect(deepMergeJson(undefined, { a: 1 })).toEqual({ a: 1 });
  });

  it('returns base when patch is null/undefined', () => {
    expect(deepMergeJson({ a: 1 }, null)).toEqual({ a: 1 });
    expect(deepMergeJson({ a: 1 }, undefined)).toEqual({ a: 1 });
  });

  it('explicit null in patch wipes the key', () => {
    expect(deepMergeJson({ a: 1, b: 2 }, { a: null })).toEqual({ a: null, b: 2 });
  });
});
