import { describe, expect, it } from 'vitest';
import { PROGRAMME_CONFIG_DEFAULTS, programmeConfigSchema } from './programme.dto';

const TOURNAMENT = '11111111-1111-4111-8111-111111111111';

describe('programmeConfigSchema, the planner sheet', () => {
  it('holds the defaults ADR-018 names, and no Swiss length of its own', () => {
    expect(PROGRAMME_CONFIG_DEFAULTS).toEqual({
      dayStartTime: '08:00',
      dayEndTime: '19:00',
      middayBreakStart: '12:00',
      middayBreakMinutes: 60,
      poolMatchDurationMinutes: 5,
      eliminationMatchDurationMinutes: 8,
      finalsMatchDurationMinutes: 10,
      matchGapSeconds: 10,
      minRestMinutes: 10,
      tournaments: [],
      breakBetweenSessionsMinutes: 10,
      refereeMeetingDurationMinutes: 30,
      arrivalAndGearCheckMinutes: 90,
    });
  });

  it('accepts its own defaults', () => {
    // Zod 4's `.default()` returns its value without validating it, so a
    // default of 0 on a length above zero would still parse `{}`. Only a
    // second pass through the schema catches it.
    expect(programmeConfigSchema.safeParse(PROGRAMME_CONFIG_DEFAULTS).success).toBe(true);
  });

  it('fills a stored sheet that lacks a field', () => {
    const sheet = programmeConfigSchema.parse({ poolMatchDurationMinutes: 7 });
    expect(sheet.poolMatchDurationMinutes).toBe(7);
    expect(sheet.finalsMatchDurationMinutes).toBe(10);
  });

  it('keeps a blank Swiss length blank, so a Swiss bout takes the pool length', () => {
    expect(programmeConfigSchema.parse({})).not.toHaveProperty('swissMatchDurationMinutes');
  });

  it.each([0, -5, 7.5])('refuses an Event length of %s', (minutes) => {
    expect(programmeConfigSchema.safeParse({ finalsMatchDurationMinutes: minutes }).success).toBe(
      false,
    );
  });

  it.each([0, -5, 7.5])('refuses a Tournament length of %s', (minutes) => {
    const sheet = {
      tournaments: [{ tournamentId: TOURNAMENT, poolMatchDurationMinutes: minutes }],
    };
    expect(programmeConfigSchema.safeParse(sheet).success).toBe(false);
  });

  it('refuses the fields ADR-021 removed', () => {
    expect(programmeConfigSchema.safeParse({ parallelLiceCount: 2 }).success).toBe(false);
    expect(programmeConfigSchema.safeParse({ middayBreakEnd: '13:00' }).success).toBe(false);
  });

  it('refuses a Tournament row that does not name a Tournament id', () => {
    const sheet = { tournaments: [{ tournamentId: 't-1', poolMatchDurationMinutes: 7 }] };
    expect(programmeConfigSchema.safeParse(sheet).success).toBe(false);
  });

  it('refuses two rows for one Tournament', () => {
    const sheet = {
      tournaments: [
        { tournamentId: TOURNAMENT, poolMatchDurationMinutes: 7 },
        { tournamentId: TOURNAMENT, finalsMatchDurationMinutes: 12 },
      ],
    };
    expect(programmeConfigSchema.safeParse(sheet).success).toBe(false);
  });
});
