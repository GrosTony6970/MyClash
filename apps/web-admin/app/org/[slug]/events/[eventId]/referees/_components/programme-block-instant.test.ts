import { describe, expect, it } from 'vitest';
import { programmeBlockStartIso } from './programme-block-instant';

describe('programmeBlockStartIso', () => {
  it('places a day-0 block at its HH:MM on the event start date', () => {
    expect(programmeBlockStartIso({ dayIndex: 0, startTime: '12:00' }, '2027-06-21')).toBe(
      '2027-06-21T12:00:00.000Z',
    );
  });

  it('shifts a later day by its dayIndex', () => {
    expect(programmeBlockStartIso({ dayIndex: 1, startTime: '09:30' }, '2027-06-21')).toBe(
      '2027-06-22T09:30:00.000Z',
    );
  });

  it('rolls into the next month across a month boundary', () => {
    expect(programmeBlockStartIso({ dayIndex: 1, startTime: '08:00' }, '2027-06-30')).toBe(
      '2027-07-01T08:00:00.000Z',
    );
  });
});
