import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BLOCK_ACCENT,
  DEFAULT_ORG_ACCENT,
  FALLBACK_BLOCK_ACCENT,
  blockTint,
  resolveBlockAccent,
} from './branding';

describe('resolveBlockAccent', () => {
  it('keeps a valid stored hex', () => {
    expect(resolveBlockAccent('break', '#ef4444')).toBe('#ef4444');
    expect(resolveBlockAccent('break', '#0EA5E9')).toBe('#0EA5E9');
  });

  it('falls back to the kind default when no colour is stored', () => {
    expect(resolveBlockAccent('break', null)).toBe(DEFAULT_BLOCK_ACCENT['break']);
    expect(resolveBlockAccent('admin', undefined)).toBe(DEFAULT_BLOCK_ACCENT['admin']);
    expect(resolveBlockAccent('competition', '')).toBe(DEFAULT_BLOCK_ACCENT['competition']);
    expect(resolveBlockAccent('workshop', '')).toBe(DEFAULT_BLOCK_ACCENT['workshop']);
  });

  it('falls back to the kind default for a malformed hex, never leaving a bar untinted', () => {
    expect(resolveBlockAccent('break', 'red')).toBe(DEFAULT_BLOCK_ACCENT['break']);
    expect(resolveBlockAccent('break', '#ab')).toBe(DEFAULT_BLOCK_ACCENT['break']);
    expect(resolveBlockAccent('break', '#12345g')).toBe(DEFAULT_BLOCK_ACCENT['break']);
  });

  it('falls back to the neutral accent for an unknown kind', () => {
    expect(resolveBlockAccent('ceremony', null)).toBe(FALLBACK_BLOCK_ACCENT);
  });
});

describe('blockTint', () => {
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

  it('never emits a broken colour value for a malformed accent', () => {
    expect(blockTint('nope')).toEqual({
      borderColor: FALLBACK_BLOCK_ACCENT,
      backgroundColor: `${FALLBACK_BLOCK_ACCENT}22`,
    });
  });
});

describe('the picker contract', () => {
  it('every default is a 6-digit hex, so a swatch can ring it and blockTint can alpha it', () => {
    const defaults = [
      DEFAULT_ORG_ACCENT,
      FALLBACK_BLOCK_ACCENT,
      ...Object.values(DEFAULT_BLOCK_ACCENT),
    ];
    for (const hex of defaults) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});
