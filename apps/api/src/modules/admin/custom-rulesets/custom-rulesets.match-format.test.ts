/**
 * A ruleset's own match format, on write (operator rulings 59 and 141, 2026-10-20/22): an emptied
 * box is stored as null, a value the engine refuses or a key it does not know is a 400 at every
 * door that stores one, and what is stored is the author's own keys, never a filled-in default.
 */
import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomRulesetsService } from './custom-rulesets.service';
import { CreateCustomRulesetDto, UpdateCustomRulesetDto } from './dto/custom-rulesets.dto';
import { supabaseRpc } from '../../../common/testing/supabase-chain';
import { createRulesetRegistry } from '../../rulesets/ruleset-registry';

const fromMock = vi.fn();
const rpc = supabaseRpc({ ruleset_pair_held_by_a_bout: () => ({ data: false, error: null }) });

function chain(result: { data?: unknown; error?: unknown }) {
  const c: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
  };
  (c as { then: unknown }).then = (resolve: (value: unknown) => unknown) => resolve(result);
  return c;
}

const CREATE = {
  name: 'House pools',
  scoreFormula: { type: 'var', name: 'victories' },
  constants: { pointsPerVictory: 3, pointsPerTie: 1, pointsPerLoss: 0, doublePenalty: 0 },
  tiebreakers: [{ variable: 'victories' as const, direction: 'desc' as const }],
  targets: [{ name: 'Hit', value: 1 }],
};

/** Formats no door may store: a cap the engine refuses, a typo key, a typo inside a phase. */
const REFUSED: Array<[string, Record<string, unknown>]> = [
  ['a cap of 0', { pointCap: 0 }],
  ['an unknown key', { pointcap: 7 }],
  ['an unknown phase', { timeLimitsSeconds: { pol: 120 } }],
];

let service: CustomRulesetsService;
let rows: ReturnType<typeof chain>;
beforeEach(() => {
  vi.clearAllMocks();
  rows = chain({
    data: { id: 'r1', code: 'TF_v1', version: '1.0.0', is_system: true },
    error: null,
  });
  fromMock.mockReturnValue(rows);
  service = new CustomRulesetsService(
    { service: { from: fromMock, rpc } } as never,
    createRulesetRegistry(),
  );
});

describe('the DTOs', () => {
  it('take a null match format, which an emptied box sends', () => {
    expect(
      CreateCustomRulesetDto.schema.safeParse({ ...CREATE, matchFormatDefaults: null }).success,
    ).toBe(true);
    expect(UpdateCustomRulesetDto.schema.safeParse({ matchFormatDefaults: null }).success).toBe(
      true,
    );
  });

  it('still take an object', () => {
    const body = { matchFormatDefaults: { pointCap: 7 } };
    expect(UpdateCustomRulesetDto.schema.safeParse(body).success).toBe(true);
  });
});

describe.each(REFUSED)('a match format with %s', (_name, matchFormatDefaults) => {
  it('is refused by the platform’s create', async () => {
    await expect(
      service.create({ ...CREATE, matchFormatDefaults }, 'actor'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('is refused by an organisation’s create', async () => {
    await expect(
      service.createForOrg('org-1', { ...CREATE, matchFormatDefaults }, 'actor'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('is refused by an update', async () => {
    await expect(service.update('r1', { matchFormatDefaults }, 'actor')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('a TF_v1 ruleset’s match format', () => {
  it('refuses a legacy key, which would override the box at seed time', async () => {
    await expect(
      service.update('r1', { tfConfig: { matchFormat: { timeLimitSeconds: 60 } } }, 'actor'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores a valid partial one as sent', async () => {
    await service.update('r1', { tfConfig: { matchFormat: { pointCap: 7 } } }, 'actor');

    const written = vi.mocked(rows['update'] as (v: unknown) => unknown).mock.calls[0]?.[0];
    expect((written as Record<string, unknown>)['tf_config']).toEqual({
      matchFormat: { pointCap: 7 },
    });
  });
});

describe('what a door stores (guards: true before the check existed)', () => {
  it('is the author’s partial object, raw', async () => {
    await service.createForOrg(
      'org-1',
      { ...CREATE, matchFormatDefaults: { pointCap: 7 } },
      'actor',
    );

    const inserted = vi.mocked(rows['insert'] as (v: unknown) => unknown).mock.calls[0]?.[0];
    expect((inserted as Record<string, unknown>)['match_format_defaults']).toEqual({ pointCap: 7 });
  });

  it('is null for an emptied box', async () => {
    await service.update('r1', { matchFormatDefaults: null }, 'actor');

    const written = vi.mocked(rows['update'] as (v: unknown) => unknown).mock.calls[0]?.[0];
    expect((written as Record<string, unknown>)['match_format_defaults']).toBeNull();
  });
});
