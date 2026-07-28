/**
 * `forkForOrg` — the org-level "adopt/clone a coded ruleset" write path.
 *
 * The row it produces must be indistinguishable from a tournament-made fork
 * (same builder), because everything downstream keys off `base_code`: the
 * resolver short-circuits to the coded engine, the publish gates skip the
 * formula dry-run, and export refuses it as non-portable.
 *
 * Split from custom-rulesets.service.test.ts to keep each file under the
 * 400-line cap.
 */
import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registry, TF_v1 } from '@myclash/rulesets';
import { CustomRulesetsService } from './custom-rulesets.service';
import type { ForkCustomRulesetDto } from './dto/custom-rulesets.dto';

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

function makeChain(result: { data?: unknown; error?: unknown } = {}) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    then: undefined,
  };
  (chain as { then: unknown }).then = (resolve: (value: unknown) => unknown) => resolve(result);
  return chain;
}

/** The insert payload the service handed to PostgREST. */
function insertedRow(): Record<string, unknown> {
  const chain = fromMock.mock.results[0]?.value as { insert: { mock: { calls: unknown[][] } } };
  return chain.insert.mock.calls[0]?.[0] as Record<string, unknown>;
}

const dto = (over: Partial<ForkCustomRulesetDto> = {}): ForkCustomRulesetDto =>
  ({
    baseCode: 'TF_v1',
    baseVersion: '1.0.0',
    name: 'Our house rules',
    targets: [
      { name: 'Deep', value: 3 },
      { name: 'Shallow', value: 2 },
    ],
    tfConfig: { winBonus: 5 },
    ...over,
  }) as ForkCustomRulesetDto;

describe('CustomRulesetsService.forkForOrg', () => {
  let service: CustomRulesetsService;

  beforeEach(() => {
    vi.clearAllMocks();
    if (!registry.has(TF_v1.code, TF_v1.version)) registry.register(TF_v1);
    service = new CustomRulesetsService(mockSupabase as never);
  });

  it('creates a coded fork that reuses the base engine', async () => {
    fromMock.mockReturnValue(makeChain({ data: { id: 'new-1' }, error: null }));

    await expect(service.forkForOrg('org-1', dto(), 'actor')).resolves.toMatchObject({
      id: 'new-1',
    });

    const row = insertedRow();
    expect(row['base_code']).toBe('TF_v1');
    expect(row['base_version']).toBe('1.0.0');
    expect(row['owner_organization_id']).toBe('org-1');
    // Empty by construction — the resolver never reads them for a base_code row.
    expect(row['score_formula']).toEqual({});
    expect(row['tiebreakers']).toEqual([]);
    // Private and immediately usable, like any org-authored row.
    expect(row['status']).toBe('published');
    expect(row['public_visibility']).toBe(false);
    expect(row['is_system']).toBe(false);
  });

  it("stores the operator's dials in tf_config", async () => {
    fromMock.mockReturnValue(makeChain({ data: { id: 'new-1' }, error: null }));
    await service.forkForOrg('org-1', dto({ tfConfig: { winBonus: 7 } }), 'actor');
    expect(insertedRow()['tf_config']).toMatchObject({ winBonus: 7 });
  });

  it("keeps the operator's edited targets over the base's defaults", async () => {
    // TargetsEditor stays editable on a coded row, so an edit made while
    // cloning must survive rather than being reset to the registry grammar.
    fromMock.mockReturnValue(makeChain({ data: { id: 'new-1' }, error: null }));
    await service.forkForOrg('org-1', dto({ targets: [{ name: 'Head', value: 9 }] }), 'actor');
    expect(insertedRow()['targets']).toEqual([{ name: 'Head', value: 9 }]);
  });

  it('takes the afterblow grammar from the base, not from the request', async () => {
    // AfterblowGrammarEditor is disabled for a coded ruleset, so the form's
    // client-side defaulting must not be able to leak into stored columns.
    fromMock.mockReturnValue(makeChain({ data: { id: 'new-1' }, error: null }));
    await service.forkForOrg(
      'org-1',
      dto({ hasAfterblow: false, afterblowValuation: 'weighted' }),
      'actor',
    );
    const row = insertedRow();
    expect(row['has_afterblow']).toBe(TF_v1.metadata?.hasAfterblow ?? true);
    expect(row['afterblow_valuation']).not.toBe('weighted');
  });

  it('rejects a base that is not a built-in', async () => {
    // The backstop that stops an org forking another org's row: adopting a
    // shared fork must re-base on ITS base, never point at the fork.
    fromMock.mockReturnValue(makeChain({ data: { id: 'new-1' }, error: null }));
    await expect(
      service.forkForOrg('org-1', dto({ baseCode: 'custom_someone_elses_fork' }), 'actor'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('rejects a fork with no scoring targets', async () => {
    // Org rows are born published, so create IS the publish gate.
    fromMock.mockReturnValue(makeChain({ data: { id: 'new-1' }, error: null }));
    await expect(service.forkForOrg('org-1', dto({ targets: [] }), 'actor')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('defaults the base version when the caller omits it', async () => {
    fromMock.mockReturnValue(makeChain({ data: { id: 'new-1' }, error: null }));
    await service.forkForOrg('org-1', dto({ baseVersion: undefined }), 'actor');
    expect(insertedRow()['base_version']).toBe('1.0.0');
  });
});
