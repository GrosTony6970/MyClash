import { describe, expect, it } from 'vitest';
import {
  durationFromStartEnd,
  endFromStartDuration,
  parseHhmm,
  workshopSessionTimes,
} from './workshop-session-times';

describe('parseHhmm', () => {
  it('parses valid HH:MM to minutes', () => {
    expect(parseHhmm('09:30')).toBe(570);
    expect(parseHhmm('00:00')).toBe(0);
    expect(parseHhmm('23:59')).toBe(1439);
  });

  it('returns null for malformed or out-of-range input', () => {
    expect(parseHhmm('')).toBeNull();
    expect(parseHhmm(null)).toBeNull();
    expect(parseHhmm('9h30')).toBeNull();
    expect(parseHhmm('24:00')).toBeNull();
    expect(parseHhmm('10:60')).toBeNull();
  });
});

describe('durationFromStartEnd', () => {
  it('computes minutes between start and end', () => {
    expect(durationFromStartEnd('09:00', '10:30')).toBe(90);
  });

  it('returns null when end is not after start', () => {
    expect(durationFromStartEnd('10:00', '10:00')).toBeNull();
    expect(durationFromStartEnd('11:00', '10:00')).toBeNull();
  });

  it('returns null on missing/invalid input', () => {
    expect(durationFromStartEnd('09:00', '')).toBeNull();
    expect(durationFromStartEnd(null, '10:00')).toBeNull();
  });
});

describe('endFromStartDuration', () => {
  it('adds the duration to the start time', () => {
    expect(endFromStartDuration('09:00', 90)).toBe('10:30');
    expect(endFromStartDuration('23:00', 30)).toBe('23:30');
  });

  it('returns null when it spills past midnight', () => {
    expect(endFromStartDuration('23:30', 60)).toBeNull();
  });

  it('returns null on missing/invalid input', () => {
    expect(endFromStartDuration('09:00', 0)).toBeNull();
    expect(endFromStartDuration('09:00', null)).toBeNull();
    expect(endFromStartDuration(null, 60)).toBeNull();
  });
});

describe('workshopSessionTimes', () => {
  it('builds start/end from an explicit end', () => {
    expect(workshopSessionTimes({ day: '2027-06-01', start: '09:00', end: '10:30' })).toEqual({
      startTime: '2027-06-01T09:00:00',
      endTime: '2027-06-01T10:30:00',
    });
  });

  it('derives end from duration when end is blank', () => {
    expect(
      workshopSessionTimes({ day: '2027-06-01', start: '09:00', durationMinutes: 45 }),
    ).toEqual({ startTime: '2027-06-01T09:00:00', endTime: '2027-06-01T09:45:00' });
  });

  it('falls back to a 60-minute default when only day+start are given', () => {
    expect(workshopSessionTimes({ day: '2027-06-01', start: '09:00' })).toEqual({
      startTime: '2027-06-01T09:00:00',
      endTime: '2027-06-01T10:00:00',
    });
  });

  it('returns null without a day or start', () => {
    expect(workshopSessionTimes({ day: null, start: '09:00' })).toBeNull();
    expect(workshopSessionTimes({ day: '2027-06-01', start: '' })).toBeNull();
    expect(workshopSessionTimes({ day: '2027-06-01', start: 'bad' })).toBeNull();
  });
});
