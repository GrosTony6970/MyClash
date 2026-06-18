import { describe, expect, it } from 'vitest';
import { blockTint } from './block-tint';

describe('blockTint', () => {
  it('returns null when no color is set (caller falls back to the kind default)', () => {
    expect(blockTint(null)).toBeNull();
    expect(blockTint('')).toBeNull();
  });

  it('returns null for a malformed hex', () => {
    expect(blockTint('red')).toBeNull();
    expect(blockTint('#ab')).toBeNull();
    expect(blockTint('#12345g')).toBeNull();
  });

  it('builds a solid border + translucent fill from a valid #rrggbb', () => {
    expect(blockTint('#ef4444')).toEqual({
      borderColor: '#ef4444',
      backgroundColor: '#ef444422',
    });
  });

  it('accepts uppercase hex', () => {
    expect(blockTint('#0EA5E9')).toEqual({
      borderColor: '#0EA5E9',
      backgroundColor: '#0EA5E922',
    });
  });
});
