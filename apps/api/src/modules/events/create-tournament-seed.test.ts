/**
 * createTournament seeds scoring_config_json from the ruleset's grammar.
 *
 * Before this, the column stayed NULL until a PATCH and `GET /match-config`
 * substituted DEFAULT_SCORING_CONFIG for NULL — so a federation scoring
 * head/torso/limb still got FFAMHE's +2/+1, 2-1/1-1 pad. createTournament had
 * no test at all; these are its first coverage.
 *
 * Its queries run in this order: events (getEventById), tournaments (slug
 * check), custom_rulesets (tf_config override lookup, inside
 * resolveRulesetConfigDefaults), tournaments (the INSERT), custom_rulesets
 * (freeze). resolveRulesetGrammar for a built-in reads the in-memory registry
 * and makes no query. The mock dispatches by TABLE NAME rather than an ordered
 * queue, which desyncs the moment a query is added — the matches mock lesson.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registry, TF_v1, Generic_PointsCap } from '@myclash/rulesets';
import { EventsService } from './events.service';
import { buildSeededScoringConfig } from './ruleset-defaults';

const assertOrgRole = vi.fn();

function makeChain(result: unknown) {
  // `update().eq().eq()` is the last hop of freezeRulesetVersion for a
  // non-system ruleset; it resolves as a promise once the eq() chain ends.
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    update: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  return chain;
}

interface SeededScoringConfig {
  afterblowMode: string;
  buttons: {
    clean: Array<{ label: string; value: number }>;
    afterblow: Array<{ label: string }>;
  };
  display: { sideColors: { red: string; blue: string }; quickPenalties: number[] };
}

function seedHarness(opts?: { customRow?: Record<string, unknown> | null }) {
  let insertPayload: Record<string, unknown> | null = null;

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'events') {
      return makeChain({
        data: { id: 'e1', organization_id: 'org-1', status: 'draft' },
        error: null,
      });
    }
    if (table === 'custom_rulesets') {
      // The tf_config override lookup, resolveRulesetGrammar's own read, and
      // the freeze's parent lookup all read this table; one (possibly null)
      // row satisfies them.
      return makeChain({ data: opts?.customRow ?? null, error: null });
    }
    if (table === 'custom_ruleset_versions') {
      // freezeRulesetVersion's UPDATE, reached only for a non-system ruleset.
      return makeChain({ data: null, error: null });
    }
    // tournaments: the slug existence check (maybeSingle → null) then the
    // INSERT (single). Capture whatever is inserted.
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      insert: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ data: { id: 't1', ...insertPayload }, error: null }),
        ),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.insert.mockImplementation((payload: Record<string, unknown>) => {
      insertPayload = payload;
      return chain;
    });
    return chain;
  });

  const svc = new EventsService(
    { service: { from } } as never,
    { assertOrgRole } as never,
    {} as never,
  );
  return { svc, seeded: () => insertPayload?.['scoring_config_json'] as SeededScoringConfig };
}

describe('createTournament — seeds scoring_config_json', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertOrgRole.mockResolvedValue(undefined);
    for (const r of [TF_v1, Generic_PointsCap]) {
      if (!registry.has(r.code, r.version)) registry.register(r);
    }
  });

  it('seeds the federal pad byte-for-byte for TF_v1', async () => {
    const { svc, seeded } = seedHarness();
    await svc.createTournament('e1', { slug: 's', name: 'T', rulesetCode: 'TF_v1' } as never, 'u1');

    const config = seeded();
    expect(config).toBeDefined();
    expect(config.afterblowMode).toBe('deductive');
    expect(config.buttons.clean.map((b) => b.label)).toEqual(['+2', '+1']);
    expect(config.buttons.afterblow.map((b) => b.label)).toEqual(['2-1', '1-1']);
    expect(config.display.sideColors).toEqual({ red: 'red', blue: 'blue' });
    expect(config.display.quickPenalties).toEqual([]);
  });

  it('seeds a custom ruleset from its own grammar, not FFAMHE defaults', async () => {
    // Head/torso/limb with weighted afterblow — before seeding this got +2/+1
    // and 2-1/1-1 no matter what it declared.
    const { svc, seeded } = seedHarness({
      customRow: {
        tf_config: null,
        is_system: false,
        targets: [
          { name: 'Head', value: 3 },
          { name: 'Limb', value: 1 },
        ],
        has_afterblow: true,
        afterblow_mode: 'deductive',
        afterblow_valuation: 'weighted',
        afterblow_fixed_value: null,
        match_format_defaults: null,
        double_penalty_formula: null,
      },
    });
    await svc.createTournament(
      'e1',
      { slug: 's', name: 'T', rulesetCode: 'custom_hema', rulesetVersion: '1.0.0' } as never,
      'u1',
    );

    const config = seeded();
    expect(config.buttons.clean.map((b) => b.label)).toEqual(['+3', '+1']);
    // weighted → the full attacker x defender grid
    expect(config.buttons.afterblow.map((b) => b.label)).toEqual(['3-3', '3-1', '1-3', '1-1']);
    expect(config.afterblowMode).toBe('deductive');
  });

  it('seeds an EMPTY afterblow list for a ruleset without afterblow', async () => {
    // Not a missing key: a missing key gets ensureButtonArray to inject
    // DEFAULT_SCORING_CONFIG's 2-1/1-1 on the next PATCH, handing afterblow
    // buttons to a ruleset that has none.
    const { svc, seeded } = seedHarness({
      customRow: {
        tf_config: null,
        is_system: false,
        targets: [{ name: 'Hit', value: 1 }],
        has_afterblow: false,
        afterblow_mode: null,
        afterblow_valuation: null,
        afterblow_fixed_value: null,
        match_format_defaults: null,
        double_penalty_formula: null,
      },
    });
    await svc.createTournament(
      'e1',
      { slug: 's', name: 'T', rulesetCode: 'custom_noab', rulesetVersion: '1.0.0' } as never,
      'u1',
    );

    const config = seeded();
    expect(config.buttons.afterblow).toEqual([]);
    expect(config.buttons.clean.map((b) => b.label)).toEqual(['+1']);
    expect(config.afterblowMode).toBe('full');
  });

  it('lets an explicit scoringConfig override win, merged like a PATCH', async () => {
    const { svc, seeded } = seedHarness();
    await svc.createTournament(
      'e1',
      {
        slug: 's',
        name: 'T',
        rulesetCode: 'TF_v1',
        scoringConfig: { afterblowMode: 'deductive' },
      } as never,
      'u1',
    );

    const config = seeded();
    // The override lands...
    expect(config.afterblowMode).toBe('deductive');
    // ...but the seeded buttons survive the deep merge rather than being wiped
    // by the partial override.
    expect(config.buttons.clean.map((b) => b.label)).toEqual(['+2', '+1']);
  });

  it('records wizard_step 1, so the seed is not read as a completed wizard', async () => {
    let payload: Record<string, unknown> | null = null;
    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'events') {
        return makeChain({
          data: { id: 'e1', organization_id: 'org-1', status: 'draft' },
          error: null,
        });
      }
      if (table === 'custom_rulesets') return makeChain({ data: null, error: null });
      const chain = {
        select: vi.fn(),
        eq: vi.fn(),
        insert: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        single: vi.fn().mockResolvedValue({ data: { id: 't1' }, error: null }),
      };
      chain.select.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      chain.insert.mockImplementation((p: Record<string, unknown>) => {
        payload = p;
        return chain;
      });
      return chain;
    });
    const svc = new EventsService(
      { service: { from } } as never,
      { assertOrgRole } as never,
      {} as never,
    );
    await svc.createTournament('e1', { slug: 's', name: 'T', rulesetCode: 'TF_v1' } as never, 'u1');
    expect((payload as Record<string, unknown> | null)?.['wizard_step']).toBe(1);
  });
});

describe('buildSeededScoringConfig (pure)', () => {
  const tfGrammar = {
    targets: [
      { name: 'Deep', value: 2 },
      { name: 'Shallow', value: 1 },
    ],
    hasAfterblow: true,
    afterblowValuation: 'fixed' as const,
    afterblowFixedValue: 1,
    defaultAfterblowMode: 'deductive' as const,
  };

  it('produces the federal pad from the grammar alone', () => {
    const seed = buildSeededScoringConfig(tfGrammar, {}) as {
      buttons: { clean: Array<{ label: string }>; afterblow: Array<{ label: string }> };
      afterblowMode: string;
    };
    expect(seed.buttons.clean.map((b) => b.label)).toEqual(['+2', '+1']);
    expect(seed.buttons.afterblow.map((b) => b.label)).toEqual(['2-1', '1-1']);
    expect(seed.afterblowMode).toBe('deductive');
  });

  it("prefers the resolved config's targets (super-admin tf_config override) over grammar metadata", () => {
    // For TF_v1 the static grammar is the federal 2/1, but a super-admin may
    // have retargeted it; the merged rulesetConfig carries the override.
    const seed = buildSeededScoringConfig(tfGrammar, {
      targets: [
        { name: 'Deep', value: 4 },
        { name: 'Shallow', value: 2 },
      ],
    }) as { buttons: { clean: Array<{ label: string }> } };
    expect(seed.buttons.clean.map((b) => b.label)).toEqual(['+4', '+2']);
  });

  it('ignores an empty config targets array and falls back to the grammar', () => {
    const seed = buildSeededScoringConfig(tfGrammar, { targets: [] }) as {
      buttons: { clean: Array<{ label: string }> };
    };
    expect(seed.buttons.clean.map((b) => b.label)).toEqual(['+2', '+1']);
  });
});
