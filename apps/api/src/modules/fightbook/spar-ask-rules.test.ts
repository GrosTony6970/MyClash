import { describe, expect, it } from 'vitest';
import { eventDayRefusal, sparExpiresAt } from './spar-ask-rules';

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
