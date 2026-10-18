import { describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  writesTo,
  type ChainResult,
  type SupabaseRow,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { PhasesService } from './phases.service';
import { rulesOf, withStampedRules } from './match-rules.fixtures';

/**
 * Pool and bracket generation read the Tournament's ruleset before their first write.
 *
 * Since 62ad709c a ruleset read that fails throws. Thrown after a write, it left the
 * generation half made: a phase with no Pools, a bracket with no bouts. Thrown after the
 * FORCE delete, it left no phase at all. The read now comes before both.
 */
const RULESET_DOWN = 'The ruleset of Tournament tournament-1 was not read: connection reset';

function makeService(seed: Record<string, TableSeed>, rulesetRead: 'fails' | 'works') {
  // The ruleset is read through the stamp of the bouts' rules: a stamp that fails is the read.
  const [tables, stamp] = withStampedRules(seed);
  const down = {
    stamp_match_rules: () => ({ data: null, error: { message: 'connection reset' } }),
  };
  const supabase = mockSupabase(tables, rulesetRead === 'fails' ? down : stamp);
  const placement = { placeMatches: vi.fn(() => Promise.resolve()) };
  const orgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
  const service = new PhasesService(
    supabase as never,
    placement as never,
    undefined,
    orgs as never,
  );
  return { service, supabase };
}

const registrations = (n: number): SupabaseRow[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    seed: i + 1,
    bib_number: null,
    tournament_id: 'tournament-1',
    status: 'registered',
    persons: { club_id: null, global_persons: null },
  }));

describe('generatePools — the ruleset is read before the force delete', () => {
  it('writes nothing, and keeps the old phase, when the ruleset cannot be read', async () => {
    const { service, supabase } = makeService(
      {
        phases: { rows: [{ id: 'old-phase', tournament_id: 'tournament-1', type: 'pool' }] },
        tournaments: {
          rows: [
            {
              id: 'tournament-1',
              weapon: null,
              event_id: 'event-1',
              events: { organization_id: 'org-1' },
            },
          ],
        },
        matches: { rows: [{ id: 'm-1', phase_id: 'old-phase', status: 'scheduled' }] },
        registrations: { rows: registrations(4) },
        pools: { rows: [{ id: 'pool-1' }] },
        pool_members: { rows: [] },
      },
      'fails',
    );

    await expect(service.generatePools('tournament-1', { poolCount: 2 }, true)).rejects.toThrow(
      RULESET_DOWN,
    );
    expect(supabase.writes).toEqual([]);
  });

  // The count of fought bouts is asked last, just before the delete (ruling 288), as the
  // bracket's is below. Here the ruleset read, which comes before it, fails first.
  it('asks the count of fought bouts after its reads, just before the delete', async () => {
    const { service, supabase } = makeService(
      {
        phases: { rows: [{ id: 'old-phase', tournament_id: 'tournament-1', type: 'pool' }] },
        tournaments: { rows: [{ id: 'tournament-1', weapon: null, event_id: 'event-1' }] },
        matches: { rows: [{ id: 'm-1', phase_id: 'old-phase', status: 'completed' }] },
        registrations: { rows: registrations(4) },
      },
      'fails',
    );

    await expect(service.generatePools('tournament-1', { poolCount: 2 }, true)).rejects.toThrow(
      RULESET_DOWN,
    );
    expect(supabase.writes).toEqual([]);
  });

  // The force delete is the first write, after every refusal: a forced regeneration the
  // field refuses used to take the old phase and make none.
  it('keeps the old phase when a forced regeneration is refused for its Pool count', async () => {
    const { service, supabase } = makeService(
      {
        phases: { rows: [{ id: 'old-phase', tournament_id: 'tournament-1', type: 'pool' }] },
        tournaments: { rows: [{ id: 'tournament-1', weapon: null, event_id: 'event-1' }] },
        matches: { rows: [{ id: 'm-1', phase_id: 'old-phase', status: 'scheduled' }] },
        registrations: { rows: registrations(3) },
      },
      'works',
    );

    await expect(service.generatePools('tournament-1', { poolCount: 5 }, true)).rejects.toThrow(
      'Cannot create 5 pools with only 3 fighters',
    );
    expect(supabase.writes).toEqual([]);
  });

  // A bout is scored with the rules its row points at: Pools of a Generic Tournament carry
  // Generic, through the copy of the Tournament's rules, never a TF_v1 nobody chose.
  it('Pools generated on a Generic Tournament carry Generic on the row', async () => {
    const { service, supabase } = makeService(
      {
        phases: [
          { data: null, error: null }, // no pool phase yet
          { data: { id: 'phase-new' }, error: null }, // the insert's id
        ],
        tournaments: {
          rows: [
            {
              id: 'tournament-1',
              weapon: null,
              event_id: null,
              ruleset_code: 'Generic_PointsCap',
              ruleset_version: '1',
              ruleset_content_hash: 'hash-1',
            },
          ],
        },
        registrations: { rows: registrations(4) },
        pools: { data: { id: 'pool-new' }, error: null },
        pool_members: { data: null, error: null },
        matches: { rows: [] },
      },
      'works',
    );

    await service.generatePools('tournament-1', { poolCount: 1 }, false);

    const bouts = writesTo(supabase, 'matches').flatMap((write) => write.row as SupabaseRow[]);
    expect(bouts).toHaveLength(6);
    for (const bout of bouts) {
      expect(bout).toMatchObject({
        match_rules_id: rulesOf('tournament-1'),
        ruleset_code: 'Generic_PointsCap',
        ruleset_version: '1.0.0',
        ruleset_content_hash: 'hash-1',
      });
    }
  });
});

describe('generateBracket — the ruleset of its bouts', () => {
  it('writes nothing, and keeps the old bracket, when the ruleset cannot be read', async () => {
    const { service, supabase } = makeService(
      {
        phases: {
          rows: [{ id: 'old-bracket', tournament_id: 'tournament-1', type: 'single_elim' }],
        },
        matches: { rows: [{ id: 'm-1', phase_id: 'old-bracket', status: 'scheduled' }] },
        registrations: { rows: registrations(8) },
        tournaments: { rows: [{ id: 'tournament-1', event_id: null }] },
        // The regeneration's audit line, written after the delete.
        audit_log: { rows: [] },
      },
      'fails',
    );

    await expect(service.generateBracket('tournament-1', {}, true)).rejects.toThrow(RULESET_DOWN);
    expect(supabase.writes).toEqual([]);
  });

  // The count of fought bouts is asked last, just before the delete (ruling 288): asked first,
  // a bout fought during the reads in between went with the bracket beyond the count the yes
  // named. Here the ruleset read, which comes before it, fails first.
  it('asks the count of fought bouts after its reads, just before the delete', async () => {
    const { service, supabase } = makeService(
      {
        phases: {
          rows: [{ id: 'old-bracket', tournament_id: 'tournament-1', type: 'single_elim' }],
        },
        matches: { rows: [{ id: 'm-1', phase_id: 'old-bracket', status: 'completed' }] },
        registrations: { rows: registrations(8) },
        tournaments: { rows: [{ id: 'tournament-1', event_id: null }] },
      },
      'fails',
    );

    await expect(service.generateBracket('tournament-1', {}, true)).rejects.toThrow(RULESET_DOWN);
    expect(supabase.writes).toEqual([]);
  });

  it('keeps the old bracket when a forced regeneration has too few fighters', async () => {
    const { service, supabase } = makeService(
      {
        phases: {
          rows: [{ id: 'old-bracket', tournament_id: 'tournament-1', type: 'single_elim' }],
        },
        matches: { rows: [{ id: 'm-1', phase_id: 'old-bracket', status: 'scheduled' }] },
        registrations: { rows: registrations(1) },
      },
      'works',
    );

    await expect(service.generateBracket('tournament-1', {}, true)).rejects.toThrow(
      'Need at least 2 fighters to generate a bracket',
    );
    expect(supabase.writes).toEqual([]);
  });

  /**
   * A bout is scored with the pair stamped on ITS row. A bracket of a Tournament on another
   * engine than TF_v1 must carry that engine, its version normalized, and its hash.
   */
  it("stamps a non-TF Tournament's ruleset on every bout it makes", async () => {
    const phases: ChainResult[] = [
      { data: null, error: null }, // no elim phase yet
      { data: { id: 'phase-new' }, error: null }, // the insert's id
      { data: null, error: null }, // the bronze slot's config update
      { data: { id: 'phase-new', type: 'single_elim', config_json: {} }, error: null },
      { data: null, error: null }, // the pool gate of the read-back
    ];
    const { service, supabase } = makeService(
      {
        phases,
        registrations: { rows: registrations(4) },
        bracket_slots: {
          rows: Array.from({ length: 4 }, (_, i) => ({
            id: `s${i}`,
            phase_id: 'phase-new',
            round: i < 2 ? 1 : 2,
            position: i,
            source_b_type: 'seed',
          })),
        },
        matches: { rows: [] },
        tournaments: {
          rows: [
            {
              id: 'tournament-1',
              event_id: null,
              ruleset_code: 'Generic_PointsCap',
              ruleset_version: '1',
              ruleset_content_hash: 'hash-1',
            },
          ],
        },
      },
      'works',
    );

    await service.generateBracket('tournament-1', {}, false);

    const bouts = writesTo(supabase, 'matches')[0]?.row as SupabaseRow[];
    expect(bouts).toHaveLength(4);
    for (const bout of bouts) {
      expect(bout).toMatchObject({
        match_rules_id: rulesOf('tournament-1'),
        ruleset_code: 'Generic_PointsCap',
        ruleset_version: '1.0.0',
        ruleset_content_hash: 'hash-1',
      });
    }
  });
});
