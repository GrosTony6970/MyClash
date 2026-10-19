import { describe, expect, it } from 'vitest';
import type { RulesExpected } from '@myclash/types';
import { UpdateTournamentDto } from './events.dto';
import { RepinTournamentRulesetDto } from './repin-ruleset.dto';

/**
 * The re-pin body (the audited settings change, revision 12): the screen sends the rules it read
 * RAW, and they reach the compare as sent — no default, no normalization, no key dropped.
 */
const schema = RepinTournamentRulesetDto.schema;

/** A TF_v1 row's rules as stored: a version "1", a formula and a forfeit policy, no buttons. */
const expected: RulesExpected = {
  rulesetCode: 'TF_v1',
  rulesetVersion: '1',
  rulesetConfig: {
    doublePenaltyFormula: 'n*(n-1)/3',
    forfeitPolicy: { kind: 'zero', nested: [1, { deep: null }] },
    legacyKey: 'kept',
  },
  scoringConfig: null,
  penaltyRulesetId: null,
  penaltyRulesetVersion: null,
};

const body = {
  rulesetCode: 'Generic_PointsCap',
  justification: 'Wrong ruleset selected during setup.',
  confirm: 'Épée Dames',
  expected,
};

describe('RepinTournamentRulesetDto', () => {
  it('passes the stored rules through verbatim', () => {
    const parsed = schema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.expected).toEqual(expected);
  });

  // The longest code a club ruleset is given: `custom_` + a 60-character slug + `-` + the time.
  const clubCode = `custom_${'a'.repeat(60)}-${Date.UTC(2058, 0).toString(36)}`;

  it('takes a club ruleset code as long as one is made, read and named', () => {
    const away = { ...body, expected: { ...expected, rulesetCode: clubCode } };
    expect(schema.safeParse(away).success).toBe(true);
    expect(schema.safeParse({ ...body, rulesetCode: clubCode }).success).toBe(true);
    expect(UpdateTournamentDto.schema.safeParse({ rulesetCode: clubCode }).success).toBe(true);
  });

  it.each([
    ['the typed name', 'confirm'],
    ['the rules read', 'expected'],
    ['the reason', 'justification'],
  ])('refuses a body without %s', (_, key) => {
    const { [key as keyof typeof body]: _dropped, ...rest } = body;
    expect(schema.safeParse(rest).success).toBe(false);
  });

  it('refuses rules read without one of their six columns, or with a seventh', () => {
    const { penaltyRulesetVersion: _, ...five } = expected;
    expect(schema.safeParse({ ...body, expected: five }).success).toBe(false);
    expect(
      schema.safeParse({ ...body, expected: { ...expected, status: 'running' } }).success,
    ).toBe(false);
  });

  it('refuses a field the re-pin does not take (strict)', () => {
    expect(schema.safeParse({ ...body, rulesetConfig: {} }).success).toBe(false);
  });
});
