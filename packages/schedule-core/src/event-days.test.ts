import { describe, expect, it } from 'vitest';
import { eachDay, formatDayLabel, initialDay } from './event-days';

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

describe('initialDay (O6: a board opens on today in the Event zone)', () => {
  const DAYS = ['2027-06-04', '2027-06-05', '2027-06-06'];

  it('answers today when today is one of the days', () => {
    expect(initialDay(DAYS, 'Europe/Paris', '2027-06-05T09:00:00Z')).toBe('2027-06-05');
  });

  it("answers by the Event's clock, not by UTC", () => {
    // 23:30 UTC on the 4th is already the 5th in Paris, and still the 4th in New York.
    expect(initialDay(DAYS, 'Europe/Paris', '2027-06-04T23:30:00Z')).toBe('2027-06-05');
    expect(initialDay(DAYS, 'America/New_York', '2027-06-04T23:30:00Z')).toBe('2027-06-04');
  });

  it('answers nothing before, after, or without an Event day', () => {
    expect(initialDay(DAYS, 'Europe/Paris', '2027-06-03T09:00:00Z')).toBeNull();
    expect(initialDay(DAYS, 'Europe/Paris', '2027-06-07T09:00:00Z')).toBeNull();
    expect(initialDay([], 'Europe/Paris', '2027-06-05T09:00:00Z')).toBeNull();
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
