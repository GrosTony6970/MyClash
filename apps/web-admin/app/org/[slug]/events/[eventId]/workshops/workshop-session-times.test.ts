import { describe, expect, it } from 'vitest';
import {
  durationFromStartEnd,
  endFromStartDuration,
  parseHhmm,
  sessionWrite,
  workshopSessionTimes,
} from './workshop-session-times';

/**
 * A save of the Workshop's form sends its session only when the session changes. The board placed
 * "Longsword basics" Saturday 10:00 in the Main hall, Room A; the organiser opens the form to fix
 * a typo in its title. The save re-sent the session with the Workshop's default venue and no room:
 * the room was wiped, and its people were told it had moved.
 */
describe('sessionWrite', () => {
  const placed = {
    startsAt: '2027-06-05T08:00:00+00:00',
    endsAt: '2027-06-05T09:00:00+00:00',
    venueId: 'v-main',
    areaId: 'a-room-a',
  };
  const same = { startTime: '2027-06-05T08:00:00.000Z', endTime: '2027-06-05T09:00:00.000Z' };
  const later = { startTime: '2027-06-05T12:00:00.000Z', endTime: '2027-06-05T13:00:00.000Z' };

  it('sends nothing when the day and times did not change', () => {
    expect(sessionWrite(same, placed, 'v-default', false)).toBeNull();
  });

  it('keeps its own venue and room when the times change', () => {
    expect(sessionWrite(later, placed, 'v-default', false)).toEqual({
      ...later,
      venueId: 'v-main',
      areaId: 'a-room-a',
    });
  });

  // An update keeps every field it is not sent: the room is named as null, or the session keeps
  // a room of the old venue.
  it('takes the session to another venue the organiser picked, out of the old room', () => {
    expect(sessionWrite(same, placed, 'v-annex', true)).toStrictEqual({
      ...same,
      venueId: 'v-annex',
      areaId: null,
    });
  });

  it('clears the venue and the room when the organiser cleared the venue', () => {
    expect(sessionWrite(same, placed, null, true)).toStrictEqual({
      ...same,
      venueId: null,
      areaId: null,
    });
  });

  it("gives a new session the form's venue", () => {
    expect(sessionWrite(later, null, 'v-default', false)).toEqual({
      ...later,
      venueId: 'v-default',
    });
    expect(sessionWrite(later, null, null, false)).toEqual({ ...later, venueId: undefined });
  });
});

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
  // Paris is CEST (UTC+2) in June → 09:00 local = 07:00Z.
  const TZ = 'Europe/Paris';

  it('builds start/end (as UTC instants in the event tz) from an explicit end', () => {
    expect(
      workshopSessionTimes({ day: '2027-06-01', start: '09:00', end: '10:30', tz: TZ }),
    ).toEqual({
      startTime: '2027-06-01T07:00:00.000Z',
      endTime: '2027-06-01T08:30:00.000Z',
    });
  });

  it('derives end from duration when end is blank', () => {
    expect(
      workshopSessionTimes({ day: '2027-06-01', start: '09:00', durationMinutes: 45, tz: TZ }),
    ).toEqual({ startTime: '2027-06-01T07:00:00.000Z', endTime: '2027-06-01T07:45:00.000Z' });
  });

  it('falls back to a 60-minute default when only day+start are given', () => {
    expect(workshopSessionTimes({ day: '2027-06-01', start: '09:00', tz: TZ })).toEqual({
      startTime: '2027-06-01T07:00:00.000Z',
      endTime: '2027-06-01T08:00:00.000Z',
    });
  });

  it('ends the next day when the end is before the start (past midnight)', () => {
    expect(
      workshopSessionTimes({ day: '2027-06-01', start: '23:00', end: '00:30', tz: TZ }),
    ).toEqual({ startTime: '2027-06-01T21:00:00.000Z', endTime: '2027-06-01T22:30:00.000Z' });
  });

  it('returns null without a day, start, or tz', () => {
    expect(workshopSessionTimes({ day: null, start: '09:00', tz: TZ })).toBeNull();
    expect(workshopSessionTimes({ day: '2027-06-01', start: '', tz: TZ })).toBeNull();
    expect(workshopSessionTimes({ day: '2027-06-01', start: 'bad', tz: TZ })).toBeNull();
    expect(workshopSessionTimes({ day: '2027-06-01', start: '09:00', tz: '' })).toBeNull();
  });
});
