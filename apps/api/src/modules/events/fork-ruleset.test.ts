/**
 * "Customise this format" forks the built-in ruleset a tournament uses into a
 * private, org-owned CODED fork (base_code) and re-points the tournament to it.
 *
 * The invariant under test is that the fork is SCORE-PRESERVING: it captures the
 * tournament's current ruleset_config as the fork's tf_config, reuses the coded
 * algorithm via base_code, and re-points WITHOUT touching ruleset_config or
 * scoring_config_json. So the operator's winBonus/target values survive the
 * fork untouched — the only thing that changes is who owns the format.
 *
 * The mock dispatches by TABLE NAME (the matches-mock lesson): an ordered queue
 * desyncs the moment a query is added.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registry, TF_v1 } from '@myclash/rulesets';
import { EventsService } from './events.service';
import { buildCodedForkRow } from './ruleset-defaults';

const assertOrgRole = vi.fn();

interface Captured {
  forkInsert: Record<string, unknown> | null;
  repoint: Record<string, unknown> | null;
  audit: Record<string, unknown> | null;
}

const EVENT_ROW = { id: 'e1', organization_id: 'org-1' };

function eventsChain() {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue({ data: EVENT_ROW, error: null }),
    single: vi.fn().mockResolvedValue({ data: EVENT_ROW, error: null }),
  });
  return chain;
}

function tournamentsChain(current: Record<string, unknown>, cap: Captured) {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    update: vi.fn((p: Record<string, unknown>) => {
      cap.repoint = p;
      return chain;
    }),
    maybeSingle: vi.fn().mockResolvedValue({ data: current, error: null }),
    single: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ data: { ...current, ...(cap.repoint ?? {}) }, error: null }),
      ),
  });
  return chain;
}

function customRulesetsChain(systemName: string, cap: Captured) {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    insert: vi.fn((p: Record<string, unknown>) => {
      cap.forkInsert = p;
      return chain;
    }),
    maybeSingle: vi.fn().mockResolvedValue({ data: { name: systemName }, error: null }),
    single: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ data: { id: 'fork-1', ...cap.forkInsert }, error: null }),
      ),
  });
  return chain;
}

function forkHarness(
  current: Record<string, unknown>,
  systemName = 'TF v1 (Tournois Fédéraux FFAMHE)',
) {
  const cap: Captured = { forkInsert: null, repoint: null, audit: null };
  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'events') return eventsChain();
    if (table === 'tournaments') return tournamentsChain(current, cap);
    if (table === 'custom_rulesets') return customRulesetsChain(systemName, cap);
    if (table === 'audit_log') {
      return {
        insert: vi.fn((p: Record<string, unknown>) => {
          cap.audit = p;
          return Promise.resolve({ error: null });
        }),
      };
    }
    return { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: null }) };
  });
  const svc = new EventsService(
    { service: { from } } as never,
    { assertOrgRole } as never,
    {} as never,
  );
  return { svc, captured: cap };
}

const TF_TOURNAMENT = {
  id: 't1',
  event_id: 'e1',
  ruleset_code: 'TF_v1',
  ruleset_version: '1.0.0',
  ruleset_config: { winBonus: 5, doublePenaltyFormula: 'n*(n-1)/3' },
  scoring_config_json: { afterblowMode: 'deductive', buttons: { clean: [], afterblow: [] } },
};

describe('forkCodedRulesetForTournament', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertOrgRole.mockResolvedValue(undefined);
    if (!registry.has(TF_v1.code, TF_v1.version)) registry.register(TF_v1);
  });

  it('creates a private coded fork carrying base_code + the tournament config', async () => {
    const { svc, captured } = forkHarness(TF_TOURNAMENT);
    await svc.forkCodedRulesetForTournament('t1', 'u1');

    const fork = captured.forkInsert!;
    expect(fork['base_code']).toBe('TF_v1');
    expect(fork['base_version']).toBe('1.0.0');
    expect(fork['is_system']).toBe(false);
    expect(fork['public_visibility']).toBe(false);
    expect(fork['owner_organization_id']).toBe('org-1');
    expect(fork['status']).toBe('published');
    expect(String(fork['code'])).toMatch(/^custom_tf_v1_fork_/);
    // The captured tournament config becomes the fork's tf_config unchanged —
    // the operator's winBonus override survives.
    expect(fork['tf_config']).toEqual({ winBonus: 5, doublePenaltyFormula: 'n*(n-1)/3' });
    // Coded fork: the AST fields are empty; the resolver reads the base engine.
    expect(fork['score_formula']).toEqual({});
    expect(fork['name']).toBe('TF v1 (Tournois Fédéraux FFAMHE) (customised)');
  });

  it('re-points the tournament to the fork WITHOUT touching config or the pad', async () => {
    const { svc, captured } = forkHarness(TF_TOURNAMENT);
    await svc.forkCodedRulesetForTournament('t1', 'u1');

    const repoint = captured.repoint!;
    expect(repoint['ruleset_code']).toBe(captured.forkInsert!['code']);
    expect(repoint['ruleset_version']).toBe('1.0.0');
    // Score-preserving: the re-point never rewrites config or the scoring pad.
    expect(repoint).not.toHaveProperty('ruleset_config');
    expect(repoint).not.toHaveProperty('scoring_config_json');
  });

  it('writes a fork audit record', async () => {
    const { svc, captured } = forkHarness(TF_TOURNAMENT);
    await svc.forkCodedRulesetForTournament('t1', 'u1');

    const audit = captured.audit!;
    expect(audit['action']).toBe('tournament.ruleset.fork');
    expect(audit['entity_type']).toBe('tournament');
    expect(audit['entity_id']).toBe('t1');
    const payload = audit['payload_json'] as Record<string, unknown>;
    expect(payload['fromCode']).toBe('TF_v1');
    expect(payload['toCode']).toBe(captured.forkInsert!['code']);
  });

  it('refuses to fork a tournament that already uses a custom (non-system) ruleset', async () => {
    const { svc } = forkHarness({
      ...TF_TOURNAMENT,
      ruleset_code: 'custom_house',
      ruleset_version: '1.0.0',
    });
    await expect(svc.forkCodedRulesetForTournament('t1', 'u1')).rejects.toThrow(/built-in/i);
  });
});

describe('buildCodedForkRow (pure)', () => {
  const grammar = {
    targets: [
      { name: 'Deep', value: 2 },
      { name: 'Shallow', value: 1 },
    ],
    hasAfterblow: true,
    afterblowValuation: 'fixed' as const,
    afterblowFixedValue: 1,
    defaultAfterblowMode: 'deductive' as const,
  };

  it('maps grammar to columns and marks the row private + published', () => {
    const row = buildCodedForkRow({
      code: 'custom_tf_v1_fork_x',
      baseCode: 'TF_v1',
      baseVersion: '1.0.0',
      name: 'TF v1 (customised)',
      ownerOrganizationId: 'org-9',
      actorUserId: 'u2',
      tfConfig: { winBonus: 4 },
      grammar,
    });
    expect(row['base_code']).toBe('TF_v1');
    expect(row['has_afterblow']).toBe(true);
    expect(row['afterblow_mode']).toBe('deductive');
    expect(row['afterblow_valuation']).toBe('fixed');
    expect(row['targets']).toEqual(grammar.targets);
    expect(row['tf_config']).toEqual({ winBonus: 4 });
    expect(row['is_system']).toBe(false);
    expect(row['public_visibility']).toBe(false);
    expect(row['status']).toBe('published');
  });

  it('nulls the afterblow columns when the grammar has no afterblow', () => {
    const row = buildCodedForkRow({
      code: 'c',
      baseCode: 'Generic_PointsCap',
      baseVersion: '1.0.0',
      name: 'x',
      ownerOrganizationId: 'o',
      actorUserId: 'u',
      tfConfig: {},
      grammar: { ...grammar, hasAfterblow: false },
    });
    expect(row['has_afterblow']).toBe(false);
    expect(row['afterblow_mode']).toBe(null);
    expect(row['afterblow_valuation']).toBe(null);
    expect(row['afterblow_fixed_value']).toBe(null);
  });
});
