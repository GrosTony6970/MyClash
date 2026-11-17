import { describe, expect, it } from 'vitest';
import { protestAtLimit, protestChipText } from './protest-chip';

describe('protestChipText', () => {
  it('shows the count alone when the Tournament has no limit', () => {
    expect(protestChipText(2, null)).toBe('2');
  });

  it('shows the count over the limit when the Tournament has one', () => {
    expect(protestChipText(2, 2)).toBe('2/2');
    expect(protestChipText(0, 0)).toBe('0/0');
  });
});

describe('protestAtLimit', () => {
  it('is true at the limit and past it', () => {
    expect(protestAtLimit(2, 2)).toBe(true);
    expect(protestAtLimit(3, 2)).toBe(true);
  });

  it('is false under the limit, and with no limit', () => {
    expect(protestAtLimit(1, 2)).toBe(false);
    expect(protestAtLimit(5, null)).toBe(false);
  });
});
