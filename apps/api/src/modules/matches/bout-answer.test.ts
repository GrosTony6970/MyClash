import { describe, expect, it, vi } from 'vitest';
import { withBoutRules } from './bout-answer';
import { builtInResolver } from './built-in-resolver.fixtures';
import { MatchesService } from './matches.service';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';

/** The bout's copy of its rules (0229), as the bout read embeds it: its engine pair (0232: the
 *  only place a bout's engine lives) and its settings. */
const copy = (over: Record<string, unknown> = {}) => ({
  ruleset_code: 'TF_v1',
  ruleset_version: '1.1.0',
  ruleset_config: { matchFormat: { pointCap: 5, bestOf: { pool: 3 } } },
  scoring_config_json: { afterblowMode: 'deductive', buttons: { clean: [3, 1], afterblow: [1] } },
  penalty_ruleset_id: 'cards-a',
  ...over,
});

const COPY_A = 'c0000000-0000-4000-8000-00000000000a';

/** A bout row: it names its copy and carries no engine of its own. */
const row = (
  version: string,
  code = 'TF_v1',
  rules: unknown = copy({ ruleset_code: code, ruleset_version: version }),
) => ({
  id: 'm1',
  match_rules_id: COPY_A,
  match_rules: rules,
});

/** The row as the pad gets it on a failure: the embed gone, nothing added. */
const BARE = { id: 'm1', match_rules_id: COPY_A };

describe('withBoutRules', () => {
  const logger = { warn: vi.fn() };

  // A copy restored from an archive is inserted as the archive holds it, and may say '1'.
  it("gives a bout the edition of its copy's ruleset version, a stored '1' read as 1.0.0", async () => {
    const rulesets = builtInResolver();
    expect(await withBoutRules(row('1.1.0'), rulesets, logger)).toMatchObject({
      decision_edition: '2026-10',
    });
    expect(await withBoutRules(row('1'), rulesets, logger)).toMatchObject({
      decision_edition: '2026-04',
    });
  });

  // Ruling K: the bout read carries the bout's own rules. The copy says cap 5, best of 3, +3,
  // deductive, card rules A; the Tournament may say anything by now: it is not read here.
  it('gives a bout the rules of its own copy, and no display', async () => {
    const out = await withBoutRules(row('1.1.0'), builtInResolver(), logger);

    expect(out.rules).toEqual({
      // The copy the rules are read from: the pad's Start names it (`startCopyOf`).
      id: COPY_A,
      matchFormat: expect.objectContaining({
        pointCap: 5,
        bestOf: expect.objectContaining({ pool: 3 }),
        maxDoubleHits: 4,
      }),
      afterblowMode: 'deductive',
      buttons: { clean: [3, 1], afterblow: [1] },
      cardRulesetId: 'cards-a',
    });
    expect(out).not.toHaveProperty('match_rules');
  });

  // The scorer decides with the copy's pair (`boutEngineOf`): the pad must decide with the same
  // one. The bout row carries no pair (0232), so nothing else could name this edition.
  it("takes the edition and the doubles rule from the copy's pair, the row carrying none", async () => {
    const generic = await withBoutRules(
      row('1.1.0', 'Generic_PointsCap'),
      builtInResolver(),
      logger,
    );
    expect(generic.decision_edition).toBe('2026-10');
    // Generic_PointsCap has no doubles rule, so no doubles limit.
    expect(generic.rules?.matchFormat.maxDoubleHits).toBeNull();

    const older = await withBoutRules(row('1.0.0', 'Generic_PointsCap'), builtInResolver(), logger);
    expect(older.decision_edition).toBe('2026-04');
  });

  it('reads a copy that pins no card rules as the built-in, and an empty copy as the defaults', async () => {
    const out = await withBoutRules(
      row('1.1.0', 'TF_v1', copy({ penalty_ruleset_id: null, scoring_config_json: {} })),
      builtInResolver(),
      logger,
    );
    expect(out.rules).toMatchObject({ cardRulesetId: null, afterblowMode: 'full' });
  });

  describe('a failure leaves the field out, says so, and never fails the read', () => {
    it('a pair that does not resolve: no edition, no rules', async () => {
      const out = await withBoutRules(row('1.0.0', 'custom_gone'), builtInResolver(), logger);
      expect(out).toEqual(BARE);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('custom_gone@1.0.0'));
    });

    it('a read that fails: no edition, no rules, the bout still opens', async () => {
      const failing = { resolve: vi.fn().mockRejectedValue(new Error('connection reset')) };
      const out = await withBoutRules(row('1.1.0'), failing as never, logger);
      expect(out).toEqual(BARE);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('connection reset'));
    });

    it('no resolver: no edition, no rules', async () => {
      expect(await withBoutRules(row('1.1.0'), undefined, logger)).toEqual(BARE);
      expect(logger.warn).toHaveBeenLastCalledWith(expect.stringContaining('no ruleset resolver'));
    });

    // A bout with no copy is a fault (`boutEngineOf`): the copy is the only place its engine
    // lives, so nothing names its edition either.
    it('no copy: no edition, no rules', async () => {
      const out = await withBoutRules(row('1.1.0', 'TF_v1', null), builtInResolver(), logger);
      expect(out).toEqual(BARE);
      expect(logger.warn).toHaveBeenLastCalledWith(
        expect.stringContaining('Bout m1: no edition and no rules sent: Bout m1 holds no copy'),
      );
    });

    // A read whose embed leaves the pair out reads as a copy that names no engine.
    it('a copy that names no engine: no edition, no rules', async () => {
      const unnamed = copy({ ruleset_code: null });
      const out = await withBoutRules(row('1.1.0', 'TF_v1', unnamed), builtInResolver(), logger);
      expect(out).toEqual(BARE);
      expect(logger.warn).toHaveBeenLastCalledWith(
        expect.stringContaining("Bout m1: no edition and no rules sent: Bout m1's copy names no"),
      );
    });

    it('a format the schema refuses: the edition, no rules', async () => {
      const refused = copy({ ruleset_config: { matchFormat: { pointCap: 'x' } } });
      const out = await withBoutRules(row('1.1.0', 'TF_v1', refused), builtInResolver(), logger);
      expect(out).toEqual({ ...BARE, decision_edition: '2026-10' });
      expect(logger.warn).toHaveBeenLastCalledWith(
        expect.stringContaining('Bout m1: no rules sent'),
      );
    });
  });
});

describe('MatchesService.getMatch', () => {
  function service(rows: Array<Record<string, unknown>>) {
    const db = mockSupabase({ matches: { rows } });
    const none = {} as never;
    const svc = new MatchesService(
      db as never,
      none,
      none,
      none,
      none,
      undefined,
      undefined,
      builtInResolver(),
    );
    return { svc, from: db.from };
  }

  it('carries the edition and the rules of the bout to the pad', async () => {
    const { svc, from } = service([row('1.0.0')]);

    const out = await svc.getMatch('m1');

    expect(out).toMatchObject({
      id: 'm1',
      decision_edition: '2026-04',
      rules: { id: COPY_A, cardRulesetId: 'cards-a', buttons: { clean: [3, 1], afterblow: [1] } },
    });
    expect(out).not.toHaveProperty('match_rules');
    expect(selectsFor(from, 'matches')[0]).toBe(
      '*, match_rules(ruleset_code, ruleset_version, ruleset_config, scoring_config_json, penalty_ruleset_id)',
    );
  });
});
