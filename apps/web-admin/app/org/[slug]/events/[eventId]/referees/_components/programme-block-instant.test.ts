import { describe, expect, it } from 'vitest';
import { programmeBlockStart } from './programme-block-instant';

describe('programmeBlockStart', () => {
  it("reads the block's HH:MM on the Event's clock, not as UTC", () => {
    // 08:00 in Paris in May is 06:00Z — before a 09:00 Paris Pool (07:00Z).
    expect(
      programmeBlockStart({ dayIndex: 0, startTime: '08:00' }, '2026-05-22', 'Europe/Paris'),
    ).toEqual({ day: '2026-05-22', startIso: '2026-05-22T06:00:00.000Z' });
  });

  it('uses the winter offset in winter', () => {
    expect(
      programmeBlockStart({ dayIndex: 0, startTime: '12:00' }, '2027-01-16', 'Europe/Paris'),
    ).toEqual({ day: '2027-01-16', startIso: '2027-01-16T11:00:00.000Z' });
  });

  it('shifts a later day by its dayIndex, across a month boundary', () => {
    expect(programmeBlockStart({ dayIndex: 1, startTime: '08:00' }, '2027-06-30', 'UTC')).toEqual({
      day: '2027-07-01',
      startIso: '2027-07-01T08:00:00.000Z',
    });
  });

  it('keeps the Event day when the instant falls on the previous UTC day', () => {
    // 00:30 in Paris on 23 May is 22:30Z on 22 May; the bar still belongs to the 23rd.
    expect(
      programmeBlockStart({ dayIndex: 1, startTime: '00:30' }, '2026-05-22', 'Europe/Paris'),
    ).toEqual({ day: '2026-05-23', startIso: '2026-05-22T22:30:00.000Z' });
  });

  it('answers null when the start date cannot be read', () => {
    expect(programmeBlockStart({ dayIndex: 0, startTime: '08:00' }, '', 'Europe/Paris')).toBeNull();
  });
});
