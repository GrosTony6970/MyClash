/**
 * Commit 3b of the re-pin audit slice: the audited mid-event ruleset re-pin.
 *
 * repinTournamentRuleset is the ONLY sanctioned way to change a tournament's
 * ruleset after results exist (the ordinary PATCH is blocked by the commit-1
 * guard). It is org-owner/super-admin only, hard-blocks completed/archived, and
 * records an append-only tournament_ruleset_repins row (from->to, per-bucket
 * diff, mandatory justification, materialised before/after placings) plus a
 * best-effort audit_log mirror.
 *
 * The mock dispatches by TABLE NAME (the matches-mock lesson). PoolStandings is
 * injected as a stub so the before/after snapshot is deterministic.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registry, TF_v1, Generic_PointsCap } from '@myclash/rulesets';
import { EventsService } from './events.service';

const assertOrgRole = vi.fn();
const EVENT_ROW = { id: 'e1', organization_id: 'org-1' };

interface Captured {
  repinInsert: Record<string, unknown> | null;
  auditLogInsert: Record<string, unknown> | null;
  tournamentUpdate: Record<string, unknown> | null;
}

interface HarnessOpts {
  current: Record<string, unknown>;
  isSuperAdmin?: boolean;
  /** false => the target ruleset does not resolve (unknown/draft/wrong version). */
  resolverResolves?: boolean;
  standingsRows?: Array<{
    rank: number;
    registrationId: string;
    displayName: string;
    stats: Record<string, unknown>;
  }>;
}

function tournamentsChain(current: Record<string, unknown>, cap: Captured) {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    update: vi.fn((p: Record<string, unknown>) => {
      cap.tournamentUpdate = p;
      return chain;
    }),
    maybeSingle: vi.fn().mockResolvedValue({ data: current, error: null }),
    single: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ data: { ...current, ...(cap.tournamentUpdate ?? {}) }, error: null }),
      ),
  });
  return chain;
}

function readChain(data: unknown) {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  });
  return chain;
}

function insertChain(onInsert: (p: Record<string, unknown>) => void) {
  return {
    insert: vi.fn((p: Record<string, unknown>) => {
      onInsert(p);
      return Promise.resolve({ error: null });
    }),
  };
}

function harness(opts: HarnessOpts) {
  const cap: Captured = { repinInsert: null, auditLogInsert: null, tournamentUpdate: null };
  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'tournaments') return tournamentsChain(opts.current, cap);
    if (table === 'events') return readChain(EVENT_ROW);
    if (table === 'platform_roles') return readChain(opts.isSuperAdmin ? { user_id: 'u1' } : null);
    if (table === 'custom_rulesets') return readChain(null);
    if (table === 'tournament_ruleset_repins') return insertChain((p) => (cap.repinInsert = p));
    if (table === 'audit_log') return insertChain((p) => (cap.auditLogInsert = p));
    return readChain(null);
  });
  const poolStandings = {
    getPoolStandings: vi.fn().mockResolvedValue({ rows: opts.standingsRows ?? [] }),
  };
  const rulesetResolver = {
    resolve: vi.fn().mockResolvedValue(opts.resolverResolves === false ? null : {}),
  };
  const svc = new EventsService(
    { service: { from } } as never,
    { assertOrgRole } as never,
    {} as never,
    undefined,
    undefined,
    undefined,
    poolStandings as never,
    rulesetResolver as never,
  );
  return { svc, cap, poolStandings, rulesetResolver };
}

const RUNNING_TF = {
  id: 't1',
  event_id: 'e1',
  status: 'running',
  ruleset_code: 'TF_v1',
  ruleset_version: '1.0.0',
  ruleset_config: { winBonus: 3 },
};

const REPIN_JUSTIFICATION = 'Wrong ruleset selected during setup; correcting to points cap.';
const DTO = {
  rulesetCode: 'Generic_PointsCap',
  justification: REPIN_JUSTIFICATION,
} as never;

describe('repinTournamentRuleset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertOrgRole.mockResolvedValue(undefined);
    if (!registry.has(TF_v1.code, TF_v1.version)) registry.register(TF_v1);
    if (!registry.has(Generic_PointsCap.code, Generic_PointsCap.version))
      registry.register(Generic_PointsCap);
  });

  it('re-points the tournament and records the audit with before/after placings', async () => {
    const { svc, cap, poolStandings } = harness({
      current: RUNNING_TF,
      standingsRows: [{ rank: 1, registrationId: 'r1', displayName: 'Alice', stats: { score: 5 } }],
    });

    await svc.repinTournamentRuleset('t1', DTO, 'u1');

    // Owner gate on the OWNER role (higher than the fork's admin bar).
    expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'u1', 'owner');
    // Re-pointed to the new ruleset with a reseeded config.
    expect(cap.tournamentUpdate?.['ruleset_code']).toBe('Generic_PointsCap');
    expect(cap.tournamentUpdate?.['ruleset_config']).toBeDefined();
    // Before + after both snapshotted (two calls) from the standings service.
    expect(poolStandings.getPoolStandings).toHaveBeenCalledTimes(2);

    const audit = cap.repinInsert!;
    expect(audit['from_code']).toBe('TF_v1');
    expect(audit['to_code']).toBe('Generic_PointsCap');
    expect(audit['justification']).toBe(REPIN_JUSTIFICATION);
    expect(typeof audit['ranking_compatible']).toBe('boolean');
    expect(audit['bucket_diff']).toMatchObject({
      grammar: expect.any(String),
      endConditions: expect.any(String),
      ranking: expect.any(String),
    });
    expect(audit['placings_before']).toEqual([
      { rank: 1, registrationId: 'r1', displayName: 'Alice', stats: { score: 5 } },
    ]);
    expect(audit['placings_after']).toBeInstanceOf(Array);
    // Generic vs TF changes the ranking bucket → not compatible.
    expect(audit['ranking_compatible']).toBe(false);

    // Best-effort mirror in the generic audit log.
    expect(cap.auditLogInsert?.['action']).toBe('tournament.ruleset.repin');
    expect(cap.auditLogInsert?.['entity_id']).toBe('t1');
  });

  it('hard-blocks a completed tournament and writes nothing', async () => {
    const { svc, cap } = harness({ current: { ...RUNNING_TF, status: 'completed' } });
    await expect(svc.repinTournamentRuleset('t1', DTO, 'u1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(cap.tournamentUpdate).toBeNull();
    expect(cap.repinInsert).toBeNull();
  });

  it('rejects a no-op re-pin to the same ruleset', async () => {
    const { svc } = harness({ current: RUNNING_TF });
    await expect(
      svc.repinTournamentRuleset(
        't1',
        { rulesetCode: 'TF_v1', justification: 'x'.repeat(12) } as never,
        'u1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a re-pin to a target ruleset that does not resolve, before any mutation', async () => {
    // e.g. a typo code, a still-draft custom ruleset, or a wrong version — the
    // resolver returns null, so the live tournament must not be bricked.
    const { svc, cap } = harness({ current: RUNNING_TF, resolverResolves: false });
    await expect(svc.repinTournamentRuleset('t1', DTO, 'u1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(cap.tournamentUpdate).toBeNull();
    expect(cap.repinInsert).toBeNull();
  });

  it('allows a super-admin who is not the org owner', async () => {
    // assertOrgRole would reject, proving the super-admin path bypasses it.
    assertOrgRole.mockRejectedValue(new ForbiddenException('not owner'));
    const { svc, cap } = harness({ current: RUNNING_TF, isSuperAdmin: true });

    await svc.repinTournamentRuleset('t1', DTO, 'u1');

    expect(assertOrgRole).not.toHaveBeenCalled();
    expect(cap.repinInsert?.['to_code']).toBe('Generic_PointsCap');
  });
});
