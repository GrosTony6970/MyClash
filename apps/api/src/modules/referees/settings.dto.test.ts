/**
 * The two bodies that write the referee rules' numbers (ADR-019): rest in day slots is
 * 0–5 on both, the daily bout cap is written by the settings screen only, and the dead
 * `enforceDedicatedRefereeRest` is refused by name (both schemas are strict).
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

  it('refuses the deleted switch', () => {
    expect(settings({ enforceDedicatedRefereeRest: true })).toBe(false);
  });
});

describe('generate-pools body', () => {
  it('bounds rest at 5 slots, as the settings screen does', () => {
    expect(generate({ refereeRestMinSlots: 5 })).toBe(true);
    expect(generate({ refereeRestMinSlots: 6 })).toBe(false);
  });

  it('writes no cap and no deleted switch', () => {
    expect(generate({ maxBoutsPerDay: 3 })).toBe(false);
    expect(generate({ enforceDedicatedRefereeRest: true })).toBe(false);
  });
});
