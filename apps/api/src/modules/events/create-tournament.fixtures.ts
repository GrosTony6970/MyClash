import { vi } from 'vitest';
import { EventsService } from './events.service';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';

/**
 * createTournament's reads, by TABLE NAME rather than an ordered queue, which
 * desyncs the moment a query is added (the matches mock lesson): events
 * (getEventById), tournaments (slug check), custom_rulesets (tf_config override
 * lookup, inside resolveRulesetConfigDefaults), tournaments (the INSERT),
 * custom_rulesets (freeze). resolveRulesetGrammar for a built-in reads the
 * in-memory registry and makes no query.
 */
export const assertOrgRole = vi.fn();

export function makeChain(result: unknown) {
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

export interface SeededScoringConfig {
  afterblowMode: string;
  buttons: {
    clean: Array<{ label: string; value: number }>;
    afterblow: Array<{ label: string }>;
  };
  display: { sideColors: { red: string; blue: string }; quickPenalties: number[] };
}

// tournaments: the slug existence check (maybeSingle → null) then the INSERT
// (single). Captures whatever is inserted into `ref.current`.
export function makeTournamentsChain(ref: { current: Record<string, unknown> | null }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    insert: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    single: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ data: { id: 't1', ...ref.current }, error: null }),
      ),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.insert.mockImplementation((payload: Record<string, unknown>) => {
    ref.current = payload;
    return chain;
  });
  return chain;
}

export function seedHarness(opts?: { customRow?: Record<string, unknown> | null }) {
  const ref: { current: Record<string, unknown> | null } = { current: null };
  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'events') {
      return makeChain({
        data: { id: 'e1', organization_id: 'org-1', status: 'draft' },
        error: null,
      });
    }
    // custom_rulesets: the tf_config override lookup, resolveRulesetGrammar's
    // read, and the freeze parent lookup all read it; one row satisfies them.
    if (table === 'custom_rulesets')
      return makeChain({ data: opts?.customRow ?? null, error: null });
    // freezeRulesetVersion's UPDATE, reached only for a non-system ruleset.
    if (table === 'custom_ruleset_versions') return makeChain({ data: null, error: null });
    return makeTournamentsChain(ref);
  });

  // The club ruleset a case seeds is offered to the Event's organisation; none
  // is when the case seeds none.
  const isSelectable = vi.fn().mockResolvedValue(Boolean(opts?.customRow));
  const svc = new EventsService(
    { service: { from } } as never,
    { assertOrgRole } as never,
    {} as never,
    createRulesetRegistry(),
    undefined,
    undefined,
    undefined,
    undefined,
    { isSelectable } as never,
  );
  return {
    svc,
    from,
    isSelectable,
    version: () => ref.current?.['ruleset_version'],
    seeded: () => ref.current?.['scoring_config_json'] as SeededScoringConfig,
    rulesetConfig: () => ref.current?.['ruleset_config'] as Record<string, unknown> | undefined,
  };
}
