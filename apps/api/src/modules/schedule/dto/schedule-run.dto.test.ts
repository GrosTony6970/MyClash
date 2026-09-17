import { describe, expect, it } from 'vitest';
import { scheduleRunSchema } from './schedule-run.dto';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const VALID = { matchIds: [id(1), id(2), id(3)], startAt: '2026-06-06T10:43:00+02:00' };

const refused = (body: unknown) => scheduleRunSchema.safeParse(body).success === false;

describe('scheduleRunSchema, the run window body', () => {
  it('accepts a move with no length, a typed length and a cleared one', () => {
    expect(scheduleRunSchema.parse(VALID)).not.toHaveProperty('plannedDurationOverrideMinutes');
    expect(
      scheduleRunSchema.parse({ ...VALID, plannedDurationOverrideMinutes: 7 })
        .plannedDurationOverrideMinutes,
    ).toBe(7);
    expect(
      scheduleRunSchema.parse({ ...VALID, plannedDurationOverrideMinutes: null })
        .plannedDurationOverrideMinutes,
    ).toBeNull();
  });

  it('accepts the UTC instant a browser sends, and a full day', () => {
    expect(
      scheduleRunSchema.safeParse({
        ...VALID,
        startAt: '2026-06-06T08:43:00.000Z',
        plannedDurationOverrideMinutes: 1440,
      }).success,
    ).toBe(true);
  });

  it('refuses a key it does not know', () => {
    expect(refused({ ...VALID, placements: [] })).toBe(true);
  });

  it('refuses a length of zero, a fraction, more than a day, or text', () => {
    for (const length of [0, -1, 1.5, 1441, '7']) {
      expect(refused({ ...VALID, plannedDurationOverrideMinutes: length }), String(length)).toBe(
        true,
      );
    }
  });

  it('refuses a Match named twice', () => {
    expect(refused({ ...VALID, matchIds: [id(1), id(2), id(1)] })).toBe(true);
  });

  it('refuses no Match, and more than 200', () => {
    expect(refused({ ...VALID, matchIds: [] })).toBe(true);
    const many = Array.from({ length: 201 }, (_, n) => id(n + 1));
    expect(refused({ ...VALID, matchIds: many })).toBe(true);
    expect(refused({ ...VALID, matchIds: many.slice(0, 200) })).toBe(false);
  });

  it('refuses a time with no offset, which the server would read in its own zone', () => {
    expect(refused({ ...VALID, startAt: '2026-06-06T10:43:00' })).toBe(true);
  });
});
