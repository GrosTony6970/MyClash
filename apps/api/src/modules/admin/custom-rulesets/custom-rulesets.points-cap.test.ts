/**
 * The built-in Points cap's `tf_config` on write (operator ruling 139, 2026-10-22): it holds Points
 * cap's own match format, which its new Tournaments start from, and nothing else. A key that would
 * change how it scores (`pointValues`), override the match format (`pointsCap`,
 * `timeLimitSeconds`) or belongs to TF v1 (`winBonus`) is a 400; so is a null match format.
 */
import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomRulesetsService } from './custom-rulesets.service';
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

let service: CustomRulesetsService;
let rows: ReturnType<typeof chain>;
function openRow(code: string): void {
  rows = chain({ data: { id: 'r1', code, version: '1.0.0', is_system: true }, error: null });
  fromMock.mockReturnValue(rows);
}
const written = () =>
  (vi.mocked(rows['update'] as (v: unknown) => unknown).mock.calls[0]?.[0] ?? {}) as Record<
    string,
    unknown
  >;

beforeEach(() => {
  vi.clearAllMocks();
  openRow('Generic_PointsCap');
  service = new CustomRulesetsService(
    { service: { from: fromMock, rpc } } as never,
    createRulesetRegistry(),
  );
});

const REFUSED: Array<[string, Record<string, unknown>]> = [
  ['a win bonus', { winBonus: 5 }],
  ['point values', { pointValues: { hit: 2 } }],
  ['a legacy points cap', { pointsCap: 7 }],
  ['a legacy time limit', { timeLimitSeconds: 60 }],
  ['a null match format', { matchFormat: null }],
  ['a match format the engine refuses', { matchFormat: { pointCap: 0 } }],
];

describe.each(REFUSED)('a Points-cap tf_config with %s', (_name, tfConfig) => {
  it('is refused, and nothing is written', async () => {
    await expect(service.update('r1', { tfConfig }, 'actor')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(rows['update']).not.toHaveBeenCalled();
  });
});

describe('a Points-cap tf_config that holds its match format only', () => {
  it('is stored as sent', async () => {
    const matchFormat = { timeLimitsSeconds: { pool: 120 } };

    await service.update('r1', { tfConfig: { matchFormat } }, 'actor');

    expect(written()['tf_config']).toEqual({ matchFormat });
  });

  it('is stored empty when the platform admin keeps nothing of their own', async () => {
    await service.update('r1', { tfConfig: {} }, 'actor');

    expect(written()['tf_config']).toEqual({});
  });
});

describe('TF v1, beside it', () => {
  it('still stores a win bonus of its own', async () => {
    openRow('TF_v1');

    await service.update('r1', { tfConfig: { winBonus: 5 } }, 'actor');

    expect(written()['tf_config']).toEqual({ winBonus: 5 });
  });
});
