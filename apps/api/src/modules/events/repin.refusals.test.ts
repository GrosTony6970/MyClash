/**
 * Who may re-pin a Tournament's ruleset, and every refusal of the audited re-pin (revision 12 of
 * the audited settings change): owner or super admin; then a completed or archived Tournament, a
 * screen whose rules moved since it read them, a name typed wrong, an unresolvable target and the
 * same pair, in that order; each refusal writes nothing.
 */
import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writesTo } from '../../common/testing/supabase-chain';
import { EXPECTED, assertOrgRole, dto, harness, type Row } from './repin.fixtures';

beforeEach(() => {
  vi.clearAllMocks();
  assertOrgRole.mockResolvedValue(undefined);
});

describe('repinTournamentRuleset: who, and the refusals (nothing written)', () => {
  /** The refusal's status and code, as the filter answers them. */
  const refusalOf = async (run: Promise<unknown>) => {
    const err = (await run.catch((e: unknown) => e)) as { getStatus?: () => number };
    const body = (err as { getResponse?: () => unknown }).getResponse?.() as Row | undefined;
    return { status: err.getStatus?.(), code: body?.['code'] };
  };

  it('asks for the owner, and lets a super admin who is not one through', async () => {
    const owner = harness();
    await owner.svc.repinTournamentRuleset('t1', dto(), 'u1');
    expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'u1', 'owner');

    assertOrgRole.mockRejectedValue(new ForbiddenException('not owner'));
    const admin = harness({ isSuperAdmin: true });
    await admin.svc.repinTournamentRuleset('t1', dto(), 'u1');
    expect(admin.calls()).toHaveLength(1);
  });

  it('answers a stranger or an org admin the same, whether its expected matches or not', async () => {
    assertOrgRole.mockRejectedValue(new ForbiddenException('not owner'));
    const { svc, calls } = harness();
    const stale = { ...EXPECTED, rulesetVersion: '9.9.9' };
    const matching = await refusalOf(svc.repinTournamentRuleset('t1', dto(), 'u2'));
    const moved = await refusalOf(svc.repinTournamentRuleset('t1', dto({ expected: stale }), 'u2'));
    expect(matching).toEqual({ status: 403, code: undefined });
    expect(moved).toEqual(matching);
    expect(calls()).toEqual([]);
  });

  it.each(['completed', 'archived'])('refuses a %s Tournament, coded', async (status) => {
    const { svc, calls } = harness({ row: { status } });
    expect(await refusalOf(svc.repinTournamentRuleset('t1', dto(), 'u1'))).toEqual({
      status: 403,
      code: 'rules_change_closed',
    });
    expect(calls()).toEqual([]);
  });

  it.each([
    ['a version read as "1"', { rulesetVersion: '1' }],
    ['other buttons', { scoringConfig: { afterblowMode: 'full' } }],
    ['another card pin', { penaltyRulesetId: 'p-1' }],
  ])('refuses a screen that read %s: 409, coded', async (_, moved) => {
    const { svc, calls } = harness();
    const run = svc.repinTournamentRuleset(
      't1',
      dto({ expected: { ...EXPECTED, ...moved } }),
      'u1',
    );
    expect(await refusalOf(run)).toEqual({ status: 409, code: 'rules_changed_since_read' });
    expect(calls()).toEqual([]);
  });

  it('takes the name typed in another case and spacing, never without its accents', async () => {
    const spaced = harness();
    await spaced.svc.repinTournamentRuleset('t1', dto({ confirm: '  ÉPÉE dames ' }), 'u1');
    expect(spaced.calls()).toHaveLength(1);
    const { svc, calls } = harness();
    const run = svc.repinTournamentRuleset('t1', dto({ confirm: 'Epee Dames' }), 'u1');
    expect(await refusalOf(run)).toEqual({ status: 400, code: 'rules_confirm_mismatch' });
    expect(calls()).toEqual([]);
  });

  // Revision 12's order: owner, closed, the rules read, the typed name, the target, unchanged.
  // Each case fails BOTH checks of a neighbouring pair: the first must be the one answered.
  it.each([
    [
      'closed before a stale read',
      { status: 'completed' },
      { expected: { ...EXPECTED, rulesetVersion: '9' } },
      403,
      'rules_change_closed',
    ],
    [
      'a stale read before the typed name',
      {},
      { expected: { ...EXPECTED, rulesetVersion: '9' }, confirm: 'x' },
      409,
      'rules_changed_since_read',
    ],
    [
      'the typed name before the same pair',
      {},
      { confirm: 'x', rulesetCode: 'TF_v1', rulesetVersion: '1.0.0' },
      400,
      'rules_confirm_mismatch',
    ],
  ])('answers %s', async (_, row, body, status, code) => {
    const { svc, calls } = harness({ row });
    expect(await refusalOf(svc.repinTournamentRuleset('t1', dto(body), 'u1'))).toEqual({
      status,
      code,
    });
    expect(calls()).toEqual([]);
  });

  it('refuses the preview of a completed Tournament before any plan, coded', async () => {
    const { svc } = harness({ row: { status: 'completed' } });
    const run = svc.previewRepinBucketDiff('t1', { rulesetCode: 'Generic_PointsCap' }, 'u1');
    expect(await refusalOf(run)).toEqual({ status: 403, code: 'rules_change_closed' });
  });

  it('refuses the pair the Tournament already has, coded', async () => {
    const { svc, calls } = harness();
    const same = dto({ rulesetCode: 'TF_v1', rulesetVersion: '1.0.0' });
    expect(await refusalOf(svc.repinTournamentRuleset('t1', same, 'u1'))).toEqual({
      status: 400,
      code: 'rules_unchanged',
    });
    expect(calls()).toEqual([]);
  });

  it('refuses a target that does not resolve, before any write', async () => {
    const { svc, calls } = harness({ offered: null });
    const run = svc.repinTournamentRuleset('t1', dto({ rulesetCode: 'custom_gone' }), 'u1');
    expect((await refusalOf(run)).status).toBe(400);
    expect(calls()).toEqual([]);
  });

  it('answers the database refusing a moved row as a 409, and writes nothing after it', async () => {
    const { svc, db, rpcAnswer } = harness();
    rpcAnswer.mockReturnValue({
      data: null,
      error: { code: 'P0001', message: 'rules_changed_since_read' },
    });
    expect(await refusalOf(svc.repinTournamentRuleset('t1', dto(), 'u1'))).toEqual({
      status: 409,
      code: 'rules_changed_since_read',
    });
    expect(writesTo(db, 'tournament_ruleset_repins')).toEqual([]);
    expect(writesTo(db, 'audit_log')).toEqual([]);
  });

  it('does not read another raise of the function as a moved row', async () => {
    const { svc, rpcAnswer } = harness();
    rpcAnswer.mockReturnValue({ data: null, error: { code: 'P0001', message: 'stamp failed' } });
    const err = await svc.repinTournamentRuleset('t1', dto(), 'u1').catch((e: unknown) => e);
    expect((err as Error).message).toContain('were not written: stamp failed');
    expect(err).not.toBeInstanceOf(ForbiddenException);
    expect((err as { getStatus?: unknown }).getStatus).toBeUndefined();
  });
});
