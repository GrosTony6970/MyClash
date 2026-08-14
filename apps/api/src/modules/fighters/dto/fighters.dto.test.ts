import { describe, expect, it } from 'vitest';
import { PublicFighterQueryDto, UpdateFighterDto, UpdateMyFighterProfileDto } from './fighters.dto';

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
