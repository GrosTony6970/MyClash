/**
 * The one owner of an audited rules write (`writeAuditedRules`) and the checks a door runs before
 * it. The door's own cases (who, the order of the refusals, the payload against the migration) are
 * in repin.test.ts; here: the compare of what the screen read, and what happens around the one
 * database call when a step after it fails.
 *
 * Seeded tables (`mockSupabase`) and the REAL RulesetHashService over them.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { BucketDiff } from '@myclash/rulesets';
import { RULES_CHANGE_CODES, type RulesExpected } from '@myclash/types';
import type { ForfeitChanges } from '@myclash/types/forfeit-rules';
import { assertReadAsExpected, writeAuditedRules } from './audited-rules-write';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';
import { RulesetHashService } from '../ruleset-hash/ruleset-hash.service';
import { mockSupabase, writesTo, type RpcAnswer } from '../../common/testing/supabase-chain';

type Row = Record<string, unknown>;

/** A TF_v1 row as stored, a formula and a forfeit policy in its settings. */
const STORED: Row = {
  id: 't1',
  event_id: 'e1',
  name: 'Sabre',
  status: 'running',
  ruleset_code: 'TF_v1',
  ruleset_version: '1',
  ruleset_config: { doublePenaltyFormula: 'n*(n-1)/3', forfeitPolicy: { kind: 'zero' } },
  scoring_config_json: null,
  penalty_ruleset_id: 'p-1',
  penalty_ruleset_version: '2.0.0',
  forfeit_rules: { disqualifyAfter: 2, reasons: { injury: { fighter: 'withdrawn' } } },
};

const EXPECTED: RulesExpected = {
  rulesetCode: 'TF_v1',
  rulesetVersion: '1',
  // Keys in another order: JSON compares by value, as the database does.
  rulesetConfig: { forfeitPolicy: { kind: 'zero' }, doublePenaltyFormula: 'n*(n-1)/3' },
  scoringConfig: null,
  penaltyRulesetId: 'p-1',
  penaltyRulesetVersion: '2.0.0',
  forfeitRules: { reasons: { injury: { fighter: 'withdrawn' } }, disqualifyAfter: 2 },
};

describe('assertReadAsExpected', () => {
  it('passes the raw row sent back verbatim, whatever the order of its keys', () => {
    expect(() => assertReadAsExpected(STORED, EXPECTED)).not.toThrow();
  });

  it('reads a column the row lacks as null, as the database does', () => {
    const { scoring_config_json: _, ...lacking } = STORED;
    expect(() => assertReadAsExpected(lacking, EXPECTED)).not.toThrow();
  });

  it.each([
    ['its version normalized', { rulesetVersion: '1.0.0' }],
    ['a setting it no longer has', { rulesetConfig: { doublePenaltyFormula: 'n*(n-1)/3' } }],
    ['buttons where there were none', { scoringConfig: {} }],
    ['another card version', { penaltyRulesetVersion: '2.1.0' }],
    ['its forfeit rules changed', { forfeitRules: { disqualifyAfter: 3 } }],
    ['its forfeit rules gone', { forfeitRules: null }],
  ])('refuses %s: 409, coded', (_, moved) => {
    const refusal = (() => {
      try {
        assertReadAsExpected(STORED, { ...EXPECTED, ...moved });
      } catch (err) {
        return err;
      }
    })();
    expect(refusal).toBeInstanceOf(ConflictException);
    expect((refusal as ConflictException).getResponse()).toMatchObject({
      code: RULES_CHANGE_CODES.changedSinceRead,
    });
  });
});

function harness(rpc: RpcAnswer = () => ({ data: 'repin-1', error: null })) {
  const row = structuredClone(STORED);
  const db = mockSupabase(
    {
      tournaments: { rows: [row] },
      events: { rows: [{ id: 'e1', penalty_ruleset_id: null }] },
      penalty_rulesets: { rows: [] },
      penalty_ruleset_versions: { rows: [] },
      tournament_ruleset_repins: { rows: [] },
      audit_log: { rows: [] },
    },
    { repin_tournament_rules: rpc },
  );
  const deps = {
    db: db.service as never,
    rulesHash: new RulesetHashService(db as never, createRulesetRegistry()),
    snapshotPlacings: vi.fn().mockResolvedValue([{ rank: 1 }]),
    logger: { warn: vi.fn() } as never as { warn: ReturnType<typeof vi.fn> },
  };
  const diff: BucketDiff = {
    grammar: 'unchanged',
    endConditions: 'changed',
    ranking: 'unchanged',
    rankingCompatible: true,
  };
  const input = {
    kind: 'ruleset' as const,
    // The door's read: a copy, never the table's own row object, as a real read is.
    read: structuredClone(row),
    next: {
      rulesetCode: 'TF_v1',
      rulesetVersion: '1.1.0',
      rulesetConfig: { ...(STORED['ruleset_config'] as Row), dropped: undefined },
      scoringConfig: null,
      forfeitRules: { disqualifyAfter: 3 } as ForfeitChanges | null,
    },
    actorUserId: 'unknown',
    justification: 'The end rule of the 2026-10 edition applies from today.',
    diff,
    changes: [],
  };
  return { db, deps, input, row };
}

describe('writeAuditedRules', () => {
  it('sends the rules as jsonb stores them, an anonymous actor as none', async () => {
    const { db, deps, input } = harness();
    await writeAuditedRules(deps as never, input);
    const args = db.rpc.mock.calls[0]?.[1] as Row;
    expect((args['p_next'] as Row)['ruleset_config']).not.toHaveProperty('dropped');
    expect(args['p_audit']).toMatchObject({ actor_user_id: null, from_version: '1.0.0' });
    expect(args['p_expected']).toMatchObject({ ruleset_version: '1', penalty_ruleset_id: 'p-1' });
  });

  it('sends the forfeit rules as read and as written, raw, and records both (0246)', async () => {
    const { db, deps, input } = harness();
    await writeAuditedRules(deps as never, input);
    const args = db.rpc.mock.calls[0]?.[1] as Row;
    expect((args['p_expected'] as Row)['forfeit_rules']).toEqual(STORED['forfeit_rules']);
    expect((args['p_next'] as Row)['forfeit_rules']).toEqual({ disqualifyAfter: 3 });
    expect(args['p_audit']).toMatchObject({
      config_before: { forfeitRules: STORED['forfeit_rules'] },
      config_after: { forfeitRules: { disqualifyAfter: 3 } },
    });
  });

  it('sends forfeit rules of none as null, and forgotten ones not at all: the database refuses', async () => {
    const none = harness();
    await writeAuditedRules(none.deps as never, {
      ...none.input,
      next: { ...none.input.next, forfeitRules: null },
    });
    expect((none.db.rpc.mock.calls[0]?.[1] as Row)['p_next']).toHaveProperty('forfeit_rules', null);

    const forgotten = harness();
    await writeAuditedRules(forgotten.deps as never, {
      ...forgotten.input,
      next: { ...forgotten.input.next, forfeitRules: undefined as never },
    });
    expect((forgotten.db.rpc.mock.calls[0]?.[1] as Row)['p_next']).not.toHaveProperty(
      'forfeit_rules',
    );
  });

  it('answers a Tournament the database no longer has as not found', async () => {
    const gone = harness(() => ({ data: null, error: { code: 'P0002', message: 'gone' } }));
    await expect(writeAuditedRules(gone.deps as never, gone.input)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(writesTo(gone.db, 'audit_log')).toEqual([]);
  });

  it('logs placings after that cannot be read, and still answers the written row', async () => {
    const { deps, input, db } = harness();
    deps.snapshotPlacings.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('standings'));
    await expect(writeAuditedRules(deps as never, input)).resolves.toMatchObject({ id: 't1' });
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('repin-1'));
    expect(writesTo(db, 'tournament_ruleset_repins')).toEqual([]);
    expect(writesTo(db, 'audit_log')).toHaveLength(1);
  });

  it('says so when the written row cannot be read back', async () => {
    const { deps, input } = harness();
    // The database answered the record; the read back of the Tournament fails.
    const failing = mockSupabase(
      {
        tournaments: { data: null, error: { message: 'down' } },
        tournament_ruleset_repins: { rows: [] },
        audit_log: { rows: [] },
      },
      { repin_tournament_rules: () => ({ data: 'repin-1', error: null }) },
    );
    const run = writeAuditedRules({ ...deps, db: failing.service } as never, input);
    await expect(run).rejects.toThrow('changed its rules but was not read back: down');
  });
});
