import { describe, expect, it } from 'vitest';
import { eventDayRefusal, openEventDays, sparExpiresAt } from './spar-ask-rules';

describe('openEventDays: the days of an Event not yet ended, and today on its clock', () => {
  const paris = { start_date: '2026-05-23', end_date: '2026-05-24', timezone: 'Europe/Paris' };

  it('lists both days on the first morning, and today is the first', () => {
    expect(openEventDays(paris, new Date('2026-05-23T08:00:00Z'))).toEqual({
      days: ['2026-05-23', '2026-05-24'],
      today: '2026-05-23',
    });
  });

  it('keeps Saturday listed until 06:00 Sunday; today is Sunday from 00:00', () => {
    // 05:59 in Paris on Sunday.
    expect(openEventDays(paris, new Date('2026-05-24T03:59:00Z'))).toEqual({
      days: ['2026-05-23', '2026-05-24'],
      today: '2026-05-24',
    });
  });

  it('lists nothing from 06:00 the morning after the last day', () => {
    expect(openEventDays(paris, new Date('2026-05-25T04:00:00Z'))).toEqual({
      days: [],
      today: null,
    });
  });

  it('walks from yesterday on a year-long Event, so day 32 and later still list', () => {
    const year = { start_date: '2026-01-01', end_date: '2026-12-31', timezone: 'Europe/Paris' };
    const { days, today } = openEventDays(year, new Date('2026-06-15T12:00:00Z'));
    // The walk starts on the 14th (closed since 06:00 Paris on the 15th) and stops after 31 days.
    expect(days).toHaveLength(30);
    expect(days[0]).toBe('2026-06-15');
    expect(days.at(-1)).toBe('2026-07-14');
    expect(today).toBe('2026-06-15');
  });

  it('still lists the first morning-after day when the walk starts a day early', () => {
    // 02:00 Paris on the 16th: the 15th is still open until 06:00, and the walk starts on the 15th.
    const year = { start_date: '2026-01-01', end_date: '2026-12-31', timezone: 'Europe/Paris' };
    const { days, today } = openEventDays(year, new Date('2026-06-16T00:00:00Z'));
    expect(days.slice(0, 2)).toEqual(['2026-06-15', '2026-06-16']);
    expect(today).toBe('2026-06-16');
  });

  it('has no today before the first day starts', () => {
    expect(openEventDays(paris, new Date('2026-05-20T10:00:00Z'))).toEqual({
      days: ['2026-05-23', '2026-05-24'],
      today: null,
    });
  });

  it('reads an America/New_York Event on its own clock, not the UTC one', () => {
    const ny = { start_date: '2026-05-23', end_date: '2026-05-24', timezone: 'America/New_York' };
    // Friday 22:00 in New York: no day has started.
    expect(openEventDays(ny, new Date('2026-05-23T02:00:00Z'))).toEqual({
      days: ['2026-05-23', '2026-05-24'],
      today: null,
    });
    // Sunday 04:00 in New York: Saturday still open, Sunday started (UTC is already 08:00).
    expect(openEventDays(ny, new Date('2026-05-24T08:00:00Z'))).toEqual({
      days: ['2026-05-23', '2026-05-24'],
      today: '2026-05-24',
    });
    // Sunday 06:00 in New York: Saturday has ended.
    expect(openEventDays(ny, new Date('2026-05-24T10:00:00Z'))).toEqual({
      days: ['2026-05-24'],
      today: '2026-05-24',
    });
  });

  it('reads an unknown zone on the default clock', () => {
    const odd = { ...paris, timezone: 'Mars/Olympus' };
    // 06:30 Sunday in Paris, 04:30 on the UTC clock: Saturday ended in Paris, not yet in UTC.
    expect(openEventDays(odd, new Date('2026-05-24T04:30:00Z'))).toEqual({
      days: ['2026-05-24'],
      today: '2026-05-24',
    });
  });

  it('stops at 31 days when a stored end date is decades away', () => {
    const wrong = { start_date: '2026-01-01', end_date: '2099-12-31', timezone: 'Europe/Paris' };
    const { days } = openEventDays(wrong, new Date('2026-01-01T10:00:00Z'));
    expect(days).toHaveLength(31);
    expect(days.at(-1)).toBe('2026-01-31');
  });

  it('answers nothing for dates that are not dates', () => {
    expect(openEventDays({ ...paris, start_date: 'soon' }, new Date())).toEqual({
      days: [],
      today: null,
    });
  });
});

describe('sparExpiresAt: a request ends at the end of its day', () => {
  it('ends an Event day at 06:00 the next morning, on the Event clock (ruling 154)', () => {
    expect(sparExpiresAt('event', '2026-05-22', 'Europe/Paris')?.toISOString()).toBe(
      '2026-05-23T04:00:00.000Z',
    );
  });

  it("ends a free date at midnight, on the asker's clock", () => {
    expect(sparExpiresAt('free', '2026-05-22', 'Europe/Paris')?.toISOString()).toBe(
      '2026-05-22T22:00:00.000Z',
    );
  });

  it('reads the closing hour on the new clock across a DST change', () => {
    expect(sparExpiresAt('event', '2026-03-29', 'Europe/Paris')?.toISOString()).toBe(
      '2026-03-30T04:00:00.000Z',
    );
  });

  it('keeps both kinds open at 23:30 on their own day', () => {
    const lateEvening = new Date('2026-05-22T21:30:00Z'); // 23:30 in Paris
    expect(sparExpiresAt('event', '2026-05-22', 'Europe/Paris')!.getTime()).toBeGreaterThan(
      lateEvening.getTime(),
    );
    expect(sparExpiresAt('free', '2026-05-22', 'Europe/Paris')!.getTime()).toBeGreaterThan(
      lateEvening.getTime(),
    );
  });

  it('answers null for a day that is not a date', () => {
    expect(sparExpiresAt('free', '22/05/2026', 'Europe/Paris')).toBeNull();
  });
});

describe('eventDayRefusal: the day must be one of the Event days', () => {
  const event = { start_date: '2026-05-22', end_date: '2026-05-24' };

  it.each(['2026-05-22', '2026-05-23', '2026-05-24'])('accepts %s', (day) => {
    expect(eventDayRefusal(day, event)).toBeNull();
  });

  it.each(['2026-05-21', '2026-05-25', '22/05/2026', ''])('refuses %s', (day) => {
    expect(eventDayRefusal(day, event)).toBe('bad_day');
  });
});
