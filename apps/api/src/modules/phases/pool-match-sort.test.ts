import { describe, expect, it } from 'vitest';
import { poolMatchSortKey } from './pool-match-sort';

describe('poolMatchSortKey', () => {
  it('sorts berger labels with two-digit suffixes in numeric order (M2 before M10)', () => {
    const labels = ['L1-PA-M3', 'L1-PA-M10', 'L1-PA-M1', 'L1-PA-M2', 'L1-PA-M11'];
    const sorted = [...labels].sort((a, b) => poolMatchSortKey(a) - poolMatchSortKey(b));
    expect(sorted).toEqual(['L1-PA-M1', 'L1-PA-M2', 'L1-PA-M3', 'L1-PA-M10', 'L1-PA-M11']);
  });

  it('sinks labels missing the -M{N} tail to the end', () => {
    const labels = ['L1-PA-M2', 'malformed-row', 'L1-PA-M1'];
    const sorted = [...labels].sort((a, b) => poolMatchSortKey(a) - poolMatchSortKey(b));
    expect(sorted).toEqual(['L1-PA-M1', 'L1-PA-M2', 'malformed-row']);
  });

  it('sinks null labels to the end', () => {
    const labels: Array<string | null> = ['L1-PA-M2', null, 'L1-PA-M1'];
    const sorted = [...labels].sort((a, b) => poolMatchSortKey(a) - poolMatchSortKey(b));
    expect(sorted).toEqual(['L1-PA-M1', 'L1-PA-M2', null]);
  });
});
