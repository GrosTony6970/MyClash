import { describe, it, expect } from 'vitest';
import { formatCountOfMax } from './format-count-of-max';

describe('formatCountOfMax', () => {
  it('renders count / max when a cap is set', () => {
    expect(formatCountOfMax(12, 32)).toBe('12 / 32');
  });

  it('renders the count alone when the cap is null', () => {
    expect(formatCountOfMax(12, null)).toBe('12');
  });

  it('honours a cap of zero — the slash still renders', () => {
    // Defensive: cap=0 is rare but valid. Falling through to the
    // null-branch would hide it; the slash makes the cap explicit.
    expect(formatCountOfMax(0, 0)).toBe('0 / 0');
  });
});
