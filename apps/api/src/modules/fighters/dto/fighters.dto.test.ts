import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  latestProfileYear,
  PublicFighterQueryDto,
  UpdateFighterDto,
  UpdateMyFighterProfileDto,
} from './fighters.dto';

/**
 * A fighter's years, "practising since" and a medal's year, run from 2000 to this year (operator,
 * 2026-10-14). "This year" is the latest calendar year anywhere on Earth (UTC+14), so a phone that
 * has just passed New Year is not refused by a server still in the old year.
 */
describe('a profile year is from 2000 to this year', () => {
  const FIGHTER = '00000000-0000-4000-8000-000000000000';
  const medal = (year: number) => ({ competition: 'Open de Lyon', year, rank: 3, weapon: 'Sabre' });
  const meParse = (input: object) =>
    UpdateMyFighterProfileDto.schema.safeParse({ fighterId: FIGHTER, ...input });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses a start year before 2000 and takes 2000, on both update routes', () => {
    for (const schema of [UpdateFighterDto.schema, UpdateMyFighterProfileDto.schema]) {
      const base = schema === UpdateFighterDto.schema ? {} : { fighterId: FIGHTER };
      expect(schema.safeParse({ ...base, practicingSinceYear: 1999 }).success).toBe(false);
      expect(schema.safeParse({ ...base, practicingSinceYear: 2000 }).success).toBe(true);
    }
  });

  it('takes this year and refuses next year as a start year', () => {
    expect(meParse({ practicingSinceYear: 2026 }).success).toBe(true);
    expect(meParse({ practicingSinceYear: 2027 }).success).toBe(false);
  });

  it('still takes null, which clears the start year', () => {
    expect(meParse({ practicingSinceYear: null }).success).toBe(true);
  });

  it('refuses a medal year before 2000 or after this year, and takes the two ends', () => {
    expect(meParse({ medals: [medal(1999)] }).success).toBe(false);
    expect(meParse({ medals: [medal(20)] }).success).toBe(false);
    expect(meParse({ medals: [medal(2027)] }).success).toBe(false);
    expect(meParse({ medals: [medal(2000)] }).success).toBe(true);
    expect(meParse({ medals: [medal(2026)] }).success).toBe(true);
  });

  it('takes next year once it is New Year somewhere on Earth', () => {
    vi.setSystemTime(new Date('2026-12-31T10:00:00Z')); // 2027-01-01 00:00 at UTC+14
    expect(latestProfileYear()).toBe(2027);
    expect(meParse({ practicingSinceYear: 2027 }).success).toBe(true);
    vi.setSystemTime(new Date('2026-12-31T09:59:59Z'));
    expect(latestProfileYear()).toBe(2026);
    expect(meParse({ practicingSinceYear: 2027 }).success).toBe(false);
  });
});

/**
 * The nesting rule has to hold at the DTO boundary as well as in the CHECK
 * constraint (0187). A 400 that names the field beats a constraint violation
 * surfacing as a scrubbed 500, and the constraint cannot say which field was
 * wrong.
 *
 * The reason this is tested rather than assumed: the rule is declared with
 * `.refine()` on updateFighterSchema, and updateMyFighterProfileSchema is built
 * from it with `.extend()`. `/fighters/me/profile` is the ONLY route the toggles
 * are sent to, so a refinement that does not survive `.extend()` is a refinement
 * that never runs anywhere it matters.
 */
describe('indexable requires listed, at the DTO boundary', () => {
  // Both schemas are .strict(), and only the "me" one carries fighterId, so the
  // required base payload differs.
  const SCHEMAS = [
    ['UpdateFighterDto', UpdateFighterDto.schema, {}] as const,
    [
      'UpdateMyFighterProfileDto',
      UpdateMyFighterProfileDto.schema,
      { fighterId: '00000000-0000-4000-8000-000000000000' },
    ] as const,
  ];

  for (const [name, schema, base] of SCHEMAS) {
    it(`${name} rejects indexable with listing explicitly off`, () => {
      const result = schema.safeParse({
        ...base,
        listedInDirectory: false,
        searchIndexable: true,
      });
      expect(result.success).toBe(false);
    });

    it(`${name} accepts indexable alongside listing on`, () => {
      const result = schema.safeParse({
        ...base,
        listedInDirectory: true,
        searchIndexable: true,
      });
      expect(result.success).toBe(true);
    });

    it(`${name} accepts indexable alone, leaving the CHECK as the backstop`, () => {
      // The row may already be listed; only a payload that would END UP
      // indexed-but-unlisted is the DTO's business.
      expect(schema.safeParse({ ...base, searchIndexable: true }).success).toBe(true);
    });

    it(`${name} accepts un-listing on its own`, () => {
      expect(schema.safeParse({ ...base, listedInDirectory: false }).success).toBe(true);
    });
  }
});

describe('PublicFighterQueryDto', () => {
  const parse = (input: unknown) => PublicFighterQueryDto.schema.safeParse(input);

  it('upper-cases a country so the RPC comparison is exact', () => {
    const result = parse({ country: 'fr' });
    expect(result.success && result.data.country).toBe('FR');
  });

  it('rejects a country that is not two letters', () => {
    expect(parse({ country: 'FRA' }).success).toBe(false);
  });

  it('rejects a sort key outside the whitelist', () => {
    // The RPC also CASE-matches, so this is the outer of two independent gates.
    expect(parse({ sort: 'email' }).success).toBe(false);
    expect(parse({ sort: 'club' }).success).toBe(true);
  });

  it('clamps limit and rejects a negative offset', () => {
    expect(parse({ limit: 500 }).success).toBe(false);
    expect(parse({ offset: -1 }).success).toBe(false);
    expect(parse({ limit: '10', offset: '20' }).success).toBe(true);
  });

  it('rejects an unknown parameter rather than ignoring it', () => {
    expect(parse({ evil: 'x' }).success).toBe(false);
  });
});
