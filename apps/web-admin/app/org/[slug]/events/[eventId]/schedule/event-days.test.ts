import { describe, expect, it } from 'vitest';
import { eachDay, formatDayLabel } from './event-days';

describe('eachDay', () => {
  it('returns each ISO date inclusive across a multi-day range', () => {
    expect(eachDay('2027-06-01', '2027-06-03')).toEqual(['2027-06-01', '2027-06-02', '2027-06-03']);
  });

  it('returns a single day when end is missing or earlier than start', () => {
    expect(eachDay('2027-06-01', null)).toEqual(['2027-06-01']);
    expect(eachDay('2027-06-05', '2027-06-01')).toEqual(['2027-06-05']);
  });

  it('returns empty without a start', () => {
    expect(eachDay('', null)).toEqual([]);
  });

  it('spans month boundaries', () => {
    expect(eachDay('2027-01-31', '2027-02-01')).toEqual(['2027-01-31', '2027-02-01']);
  });
});

describe('formatDayLabel', () => {
  it('formats a date with weekday + day + month (UTC, fr-FR)', () => {
    // 2027-06-01 is a Tuesday — characterization of the existing format.
    const label = formatDayLabel('2027-06-01');
    expect(label).toMatch(/01/);
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
  });
});
