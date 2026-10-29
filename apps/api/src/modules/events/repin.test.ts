/**
 * The audited mid-event ruleset re-pin (the audited settings change, revision 12 of its plan).
 *
 * repinTournamentRuleset is the ONLY sanctioned way to change a tournament's ruleset after results
 * exist. It hands the whole change to ONE database call (`repin_tournament_rules`, 0234), whose
 * payload keys are pinned here against the migration that defines it; its refusals are in
 * `repin.refusals.test.ts`, the harness in `repin.fixtures.ts`.
 */
import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { restampUnstartedMatches } from '../phases/match-ruleset';
import type * as MatchRuleset from '../phases/match-ruleset';
import { writesTo } from '../../common/testing/supabase-chain';
import { lastFunctionBody, lastFunctionParams } from '../../common/testing/migration-function';
import { EXPECTED, REASON, RPC, assertOrgRole, dto, harness, type Row } from './repin.fixtures';

vi.mock('../phases/match-ruleset', async (original) => ({
  ...(await original<typeof MatchRuleset>()),
  restampUnstartedMatches: vi.fn(() => Promise.resolve()),
}));

/** The keys the function body reads off one of its jsonb parameters. */
const keysRead = (param: string) =>
  [...lastFunctionBody(RPC).matchAll(new RegExp(`${param}->>?'(\\w+)'`, 'g'))]
    .map((hit) => hit[1])
    .sort();

beforeEach(() => {
  vi.clearAllMocks();
  assertOrgRole.mockResolvedValue(undefined);
});

describe('repinTournamentRuleset: one audited write', () => {
  it('calls the database function with exactly the keys it reads', async () => {
    const { svc, calls } = harness();
    await svc.repinTournamentRuleset('t1', dto(), 'u1');

    const [args] = calls();
    expect(Object.keys(args!)).toEqual(lastFunctionParams(RPC));
    const keysOf = (key: string) => Object.keys(args![key] as Row).sort();
    expect(keysOf('p_expected')).toEqual(keysRead('p_expected'));
    expect(keysOf('p_next')).toEqual(keysRead('p_next'));
    expect(keysOf('p_audit')).toEqual(keysRead('p_audit'));
  });

  it('sends the row as read, the rules to write and the record', async () => {
    const { svc, calls } = harness();
    await svc.repinTournamentRuleset('t1', dto(), 'u1');

    const [args] = calls();
    expect(args!['p_tournament_id']).toBe('t1');
    expect(args!['p_expected']).toEqual({
      ruleset_code: 'TF_v1',
      ruleset_version: '1.0.0',
      ruleset_config: { winBonus: 3 },
      scoring_config_json: null,
      penalty_ruleset_id: null,
      penalty_ruleset_version: null,
      forfeit_rules: null,
    });
    const next = args!['p_next'] as Row;
    expect(next).toMatchObject({ ruleset_code: 'Generic_PointsCap', ruleset_version: '1.1.0' });
    expect(next['ruleset_content_hash']).toMatch(/^[0-9a-f]{64}$/);
    const audit = args!['p_audit'] as Row;
    // The record's Event is the locked row's, never one the caller names.
    expect(audit).not.toHaveProperty('event_id');
    expect(audit).toMatchObject({
      actor_user_id: 'u1',
      kind: 'ruleset',
      from_code: 'TF_v1',
      from_version: '1.0.0',
      to_code: 'Generic_PointsCap',
      to_version: '1.1.0',
      justification: REASON,
      ranking_compatible: false,
      placings_before: [
        { rank: 1, registrationId: 'r1', displayName: 'Alice', stats: { score: 5 } },
      ],
      config_before: { rulesetConfig: { winBonus: 3 }, scoringConfig: null, forfeitRules: null },
      config_after: {
        rulesetConfig: next['ruleset_config'],
        scoringConfig: next['scoring_config_json'],
        forfeitRules: null,
      },
    });
    const changes = audit['changes'] as Array<{ path: string; locked: boolean }>;
    expect(changes.map((change) => change.path)).toContain('engine');
    expect(changes.every((change) => change.locked)).toBe(true);
  });

  it('keeps the forfeit rules the Tournament holds, raw, as it read them (0246)', async () => {
    const stored = { reasons: { injury: { fighter: 'withdrawn' } }, restored: {} };
    const { svc, calls } = harness({ row: { forfeit_rules: stored } });
    await svc.repinTournamentRuleset(
      't1',
      dto({ expected: { ...EXPECTED, forfeitRules: stored } }),
      'u1',
    );

    const [args] = calls();
    expect((args!['p_expected'] as Row)['forfeit_rules']).toEqual(stored);
    expect((args!['p_next'] as Row)['forfeit_rules']).toEqual(stored);
  });

  it('writes nothing else itself, fills the placings after by the record id, and mirrors it', async () => {
    const { svc, db, row } = harness();
    const { tournament } = await svc.repinTournamentRuleset('t1', dto(), 'u1');

    expect(writesTo(db, 'tournaments')).toEqual([]);
    const fills = writesTo(db, 'tournament_ruleset_repins');
    expect(fills.map((write) => [write.op, write.row, write.filters[0]?.args])).toEqual([
      ['update', { placings_after: expect.any(Array) }, ['id', 'repin-1']],
    ]);
    const [mirror] = writesTo(db, 'audit_log');
    expect(mirror?.row).toMatchObject({
      action: 'tournament.ruleset.repin',
      entity_id: 't1',
      payload_json: {
        repinId: 'repin-1',
        kind: 'ruleset',
        eventId: 'e1',
        fromCode: 'TF_v1',
        fromVersion: '1.0.0',
        toCode: 'Generic_PointsCap',
      },
    });
    // The row as written, read back (never the row read before); the database stamped the bouts.
    expect(tournament).toMatchObject({ ruleset_code: 'Generic_PointsCap' });
    expect(tournament).not.toBe(row);
    expect(row['ruleset_content_hash']).toBe('stale');
    expect(tournament['ruleset_content_hash']).not.toBe('stale');
    expect(vi.mocked(restampUnstartedMatches)).not.toHaveBeenCalled();
  });

  it('leaves no drift: the hash written is the fingerprint of the row written', async () => {
    const { svc, rulesHash } = harness();
    await svc.repinTournamentRuleset('t1', dto(), 'u1');
    expect((await rulesHash.describeTournamentDrift('t1')).drifted).toBe(false);
  });

  it('re-pins to the latest version of a built-in when none is named', async () => {
    const { svc, calls } = harness();
    await svc.repinTournamentRuleset('t1', dto({ rulesetCode: 'TF_v1' }), 'u1');
    expect(calls()[0]!['p_next']).toMatchObject({ ruleset_version: '1.1.0' });
    expect(calls()[0]!['p_audit']).toMatchObject({ to_version: '1.1.0' });
  });

  it('re-pins a club ruleset named with no version at its current one', async () => {
    const { svc, calls } = harness({ offered: '1.0.1' });
    await svc.repinTournamentRuleset('t1', dto({ rulesetCode: 'custom_house' }), 'u1');
    expect(calls()[0]!['p_audit']).toMatchObject({ to_code: 'custom_house', to_version: '1.0.1' });
  });
});

describe('previewRepinBucketDiff', () => {
  it('answers the lamps and the same changes the re-pin records, writing nothing', async () => {
    const { svc, db, calls } = harness();
    const preview = await svc.previewRepinBucketDiff(
      't1',
      { rulesetCode: 'Generic_PointsCap' },
      'u1',
    );
    expect(calls()).toEqual([]);
    expect(db.writes).toEqual([]);
    expect(preview).toMatchObject({ fromCode: 'TF_v1', toCode: 'Generic_PointsCap' });
    expect(preview.diff.rankingCompatible).toBe(false);

    const { rulesetChange } = await svc.repinTournamentRuleset('t1', dto(), 'u1');
    expect(preview.changes).toEqual(rulesetChange.changes);
    expect(calls()[0]!['p_audit']).toMatchObject({ changes: preview.changes });
  });

  it('asks the picker for the same club pair as the re-pin', async () => {
    const { svc, selectableRulesets } = harness({ isSuperAdmin: true });
    await svc.repinTournamentRuleset('t1', dto({ rulesetCode: 'custom_house' }), 'u1');
    await svc.previewRepinBucketDiff('t1', { rulesetCode: 'custom_house' }, 'u1');
    expect(selectableRulesets.offeredVersion.mock.calls).toEqual([
      ['org-1', 'custom_house', undefined, { withDrafts: true }],
      ['org-1', 'custom_house', undefined, { withDrafts: true }],
    ]);
  });

  it('keeps the owner gate and the unresolvable-target refusal', async () => {
    const unknown = harness({ offered: null });
    await expect(
      unknown.svc.previewRepinBucketDiff('t1', { rulesetCode: 'custom_gone' }, 'u1'),
    ).rejects.toThrow('does not exist');
    assertOrgRole.mockRejectedValue(new ForbiddenException('not owner'));
    const { svc } = harness();
    await expect(
      svc.previewRepinBucketDiff('t1', { rulesetCode: 'Generic_PointsCap' }, 'u1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
