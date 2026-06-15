import { describe, expect, it } from 'vitest';
import { runEndIso } from './run-end';

describe('runEndIso', () => {
  it('returns last start + the inferred per-match interval (median gap)', () => {
    expect(
      runEndIso([
        '2027-06-21T09:00:00.000Z',
        '2027-06-21T09:03:00.000Z',
        '2027-06-21T09:06:00.000Z',
      ]),
    ).toBe('2027-06-21T09:09:00.000Z');
  });

  it('sorts unordered starts before computing', () => {
    expect(
      runEndIso([
        '2027-06-21T09:06:00.000Z',
        '2027-06-21T09:00:00.000Z',
        '2027-06-21T09:03:00.000Z',
      ]),
    ).toBe('2027-06-21T09:09:00.000Z');
  });

  it('uses the median gap when intervals are irregular', () => {
    // gaps 3, 3, 9 → median 3 → end = 09:18 + 3 = 09:21
    expect(
      runEndIso([
        '2027-06-21T09:00:00.000Z',
        '2027-06-21T09:03:00.000Z',
        '2027-06-21T09:06:00.000Z',
        '2027-06-21T09:18:00.000Z',
      ]),
    ).toBe('2027-06-21T09:21:00.000Z');
  });

  it('falls back to +fallbackMin for a single match', () => {
    expect(runEndIso(['2027-06-21T09:00:00.000Z'])).toBe('2027-06-21T09:05:00.000Z');
    expect(runEndIso(['2027-06-21T09:00:00.000Z'], 3)).toBe('2027-06-21T09:03:00.000Z');
  });

  it('returns null when there are no matches', () => {
    expect(runEndIso([])).toBeNull();
  });
});
