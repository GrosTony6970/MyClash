/**
 * The one body that writes the referee rules (ADR-019, ruling 142): rest in day slots is 0–5,
 * the daily bout cap 0–200; a deleted switch or an Impossible rule is refused by name, and
 * Generate Pools takes no referee key at all (both schemas are strict).
 */
import { describe, expect, it } from 'vitest';
import { GeneratePoolsDto } from '../phases/dto/phases.dto';
import { UpdateSettingsDto } from './settings.controller';

const settings = (body: unknown) => UpdateSettingsDto.schema.safeParse(body).success;
const generate = (body: unknown) => GeneratePoolsDto.schema.safeParse(body).success;

describe('referee settings body', () => {
  it('takes a bout cap from 0 (no cap) to 200, whole numbers only', () => {
    expect([0, 12, 200].map((n) => settings({ maxBoutsPerDay: n }))).toEqual([true, true, true]);
    expect([-1, 201, 2.5].map((n) => settings({ maxBoutsPerDay: n }))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('takes rest from 0 to 5 slots', () => {
    expect(settings({ refereeRestMinSlots: 5 })).toBe(true);
    expect(settings({ refereeRestMinSlots: 6 })).toBe(false);
  });

  it.each([
    'enforceDedicatedRefereeRest',
    'enableOfficiateVsFightRule',
    'enableDoubleBookedRule',
    'enableAvailabilityRule',
    'enforceFighterRefereeNoOverlap',
  ])('refuses %s: a deleted switch, or a rule that has none', (key) => {
    expect(settings({ [key]: true })).toBe(false);
  });
});

describe('generate-pools body', () => {
  it('still takes the pool keys', () => {
    expect(generate({ enforceSchoolSeparation: true, targetSize: 6 })).toBe(true);
  });

  // The referee rules are set in one place, the Event's panel (ruling 142).
  it.each([
    'enforceRefereeNoBackToBack',
    'refereeRestMinSlots',
    'enforceFighterRefereeNoOverlap',
    'preferHighRatedReferees',
    'maxBoutsPerDay',
    'enforceDedicatedRefereeRest',
  ])('refuses the referee key %s', (key) => {
    expect(generate({ [key]: key === 'refereeRestMinSlots' ? 1 : true })).toBe(false);
  });
});
