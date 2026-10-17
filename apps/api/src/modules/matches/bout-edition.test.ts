import { describe, expect, it, vi } from 'vitest';
import { withDecisionEdition } from './bout-edition';
import { builtInResolver } from './built-in-resolver.fixtures';
import { MatchesService } from './matches.service';
import { mockSupabase } from '../../common/testing/supabase-chain';

const row = (version: string, code = 'TF_v1') => ({
  id: 'm1',
  ruleset_code: code,
  ruleset_version: version,
});

describe('withDecisionEdition', () => {
  const logger = { warn: vi.fn() };

  it("gives a bout the edition of its own ruleset version, a stored '1' read as 1.0.0", async () => {
    const rulesets = builtInResolver();
    expect(await withDecisionEdition(row('1.1.0'), rulesets, logger)).toMatchObject({
      decision_edition: '2026-10',
    });
    expect(await withDecisionEdition(row('1'), rulesets, logger)).toMatchObject({
      decision_edition: '2026-04',
    });
  });

  it('leaves the edition out, and says so, for a pair that does not resolve', async () => {
    const out = await withDecisionEdition(row('1.0.0', 'custom_gone'), builtInResolver(), logger);
    expect(out).not.toHaveProperty('decision_edition');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('custom_gone@1.0.0'));
  });

  it('leaves the edition out, and says so, for a read that fails: the bout still opens', async () => {
    const failing = { resolve: vi.fn().mockRejectedValue(new Error('connection reset')) };
    const out = await withDecisionEdition(row('1.1.0'), failing as never, logger);
    expect(out).toEqual(row('1.1.0'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('connection reset'));
  });

  it('leaves the row as it is with no resolver, and says so', async () => {
    expect(await withDecisionEdition(row('1.1.0'), undefined, logger)).toEqual(row('1.1.0'));
    expect(logger.warn).toHaveBeenLastCalledWith(expect.stringContaining('no ruleset resolver'));
  });
});

describe('MatchesService.getMatch', () => {
  it('carries the edition of the bout to the pad', async () => {
    const db = mockSupabase({ matches: { rows: [row('1.0.0')] } });
    const none = {} as never;
    const service = new MatchesService(
      db as never,
      none,
      none,
      none,
      none,
      undefined,
      undefined,
      builtInResolver(),
    );
    expect(await service.getMatch('m1')).toMatchObject({ id: 'm1', decision_edition: '2026-04' });
  });
});
