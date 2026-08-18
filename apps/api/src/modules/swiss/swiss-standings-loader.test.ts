import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, queriedTables } from '../../common/testing/supabase-chain';
import type { SupabaseService } from '../supabase/supabase.service';
import type { RulesetResolver } from '../matches/ruleset-resolver.service';
import { DEFAULT_SWISS_POINTS, DEFAULT_SWISS_TIEBREAK_CHAIN } from './dto/swiss-config.dto';
import {
  loadScoringInputs,
  loadSwissContext,
  resolveTournamentRuleset,
} from './swiss-standings-loader';

const as = (supabase: { service: unknown }): SupabaseService =>
  supabase as unknown as SupabaseService;

const CONFIG = {
  roundCount: 5,
  seedingStrategy: 'random',
  pairingMethod: 'fold',
  grouping: { kind: 'points' },
  rankBy: 'swissPts',
  points: { ...DEFAULT_SWISS_POINTS },
  tiebreakChain: [...DEFAULT_SWISS_TIEBREAK_CHAIN],
};

const ok = { data: [], error: null };

describe('loadSwissContext', () => {
  it('returns null when the tournament has no Swiss phase', async () => {
    const supabase = mockSupabase({ phases: { data: null, error: null } });
    await expect(loadSwissContext(as(supabase), 't1')).resolves.toBeNull();
    // Stops at phases — any further table would have thrown as unconfigured.
    expect(queriedTables(supabase.from)).toEqual(['phases']);
  });

  it('rejects a Swiss phase whose config does not parse', async () => {
    const supabase = mockSupabase({
      phases: { data: { id: 'p1', config_json: { nope: true } }, error: null },
    });
    await expect(loadSwissContext(as(supabase), 't1')).rejects.toThrow(BadRequestException);
    await expect(loadSwissContext(as(supabase), 't1')).rejects.toThrow(/invalid config/);
  });

  it('loads entrants, rounds and matches for a valid phase', async () => {
    // Every table here also holds a row belonging to ANOTHER phase. A fixture
    // without them cannot tell a scoped read from an unscoped one.
    const supabase = mockSupabase({
      phases: {
        rows: [
          { id: 'p1', tournament_id: 't1', type: 'swiss', config_json: CONFIG },
          { id: 'p9', tournament_id: 't9', type: 'swiss', config_json: CONFIG },
        ],
      },
      swiss_entrants: {
        rows: [
          { phase_id: 'p1', registration_id: 'r1', withdrawn_at_round: null, registrations: {} },
          { phase_id: 'p9', registration_id: 'r9', withdrawn_at_round: null, registrations: {} },
        ],
      },
      swiss_rounds: {
        rows: [
          { id: 'sr1', phase_id: 'p1', round_number: 1, status: 'completed' },
          { id: 'sr9', phase_id: 'p9', round_number: 1, status: 'completed' },
        ],
      },
      matches: {
        rows: [
          { id: 'm1', phase_id: 'p1', swiss_round_id: 'sr1', status: 'completed' },
          { id: 'm9', phase_id: 'p9', swiss_round_id: 'sr9', status: 'completed' },
        ],
      },
    });

    const context = await loadSwissContext(as(supabase), 't1');
    expect(context).toMatchObject({ tournamentId: 't1', phaseId: 'p1' });
    expect(context?.entrants.map((e) => e.registration_id)).toEqual(['r1']);
    expect(context?.rounds.map((r) => r.id)).toEqual(['sr1']);
    expect(context?.matches.map((m) => m.id)).toEqual(['m1']);
    expect(queriedTables(supabase.from)).toEqual([
      'phases',
      'swiss_entrants',
      'swiss_rounds',
      'matches',
    ]);
  });

  it('returns the rounds in the order they were fought', async () => {
    // Seeded out of order on purpose. The standings count rounds completed off
    // the front of this list, and the round card reads it as round 1, 2, 3.
    const supabase = mockSupabase({
      phases: { rows: [{ id: 'p1', tournament_id: 't1', type: 'swiss', config_json: CONFIG }] },
      swiss_entrants: { rows: [] },
      swiss_rounds: {
        rows: [
          { id: 'sr3', phase_id: 'p1', round_number: 3, status: 'pending' },
          { id: 'sr1', phase_id: 'p1', round_number: 1, status: 'completed' },
          { id: 'sr2', phase_id: 'p1', round_number: 2, status: 'completed' },
        ],
      },
      matches: { rows: [] },
    });

    const context = await loadSwissContext(as(supabase), 't1');

    expect(context?.rounds.map((r) => r.round_number)).toEqual([1, 2, 3]);
  });

  it('coerces null result sets to empty arrays rather than propagating null', async () => {
    const supabase = mockSupabase({
      phases: { data: { id: 'p1', config_json: CONFIG }, error: null },
      swiss_entrants: { data: null, error: null },
      swiss_rounds: { data: null, error: null },
      matches: { data: null, error: null },
    });
    const context = await loadSwissContext(as(supabase), 't1');
    expect(context?.entrants).toEqual([]);
    expect(context?.rounds).toEqual([]);
    expect(context?.matches).toEqual([]);
  });

  it.each([
    ['swiss_entrants', 'entrants exploded'],
    ['swiss_rounds', 'rounds exploded'],
    ['matches', 'matches exploded'],
  ])('surfaces a %s error as BadRequest', async (table, message) => {
    const supabase = mockSupabase({
      phases: { data: { id: 'p1', config_json: CONFIG }, error: null },
      swiss_entrants: ok,
      swiss_rounds: ok,
      matches: ok,
      [table]: { data: null, error: { message } },
    });
    await expect(loadSwissContext(as(supabase), 't1')).rejects.toThrow(message);
  });
});

describe('loadScoringInputs', () => {
  it('short-circuits on an empty match list without querying anything', async () => {
    // No tables configured at all: if it queried, supabaseFrom would throw.
    const supabase = mockSupabase({});
    const result = await loadScoringInputs(as(supabase), []);
    expect(result.exchangesByMatch.size).toBe(0);
    expect(result.forfeitCountByReg.size).toBe(0);
    expect(queriedTables(supabase.from)).toEqual([]);
  });

  it('groups exchanges by match, skipping other bouts and voided hits', async () => {
    // The two decoys are what the scope is for: an exchange of a bout nobody
    // asked about, and a voided one. A voided hit counted here reads as points
    // a fighter did not score.
    const supabase = mockSupabase({
      exchanges: {
        rows: [
          { match_id: 'm1', type: 'single', first_striker_color: 'red', voided: false },
          { match_id: 'm1', type: 'double', first_striker_color: null, voided: false },
          { match_id: 'm2', type: 'single', first_striker_color: 'blue', voided: false },
          { match_id: 'm1', type: 'single', first_striker_color: 'red', voided: true },
          { match_id: 'm-elsewhere', type: 'single', first_striker_color: 'red', voided: false },
        ],
      },
      match_forfeits: { rows: [] },
    });
    const { exchangesByMatch } = await loadScoringInputs(as(supabase), ['m1', 'm2']);
    expect(exchangesByMatch.get('m1')).toHaveLength(2);
    expect(exchangesByMatch.get('m2')).toHaveLength(1);
    expect([...exchangesByMatch.keys()].sort()).toEqual(['m1', 'm2']);
  });

  it('counts repeat forfeits per registration, and only real ones', async () => {
    // Three decoys, one per axis: a RESULT OVERRIDE, which shares this table
    // and is not a forfeit; a forfeit already voided; and a forfeit on a bout
    // nobody asked about. Each one would inflate a fighter's F column.
    const forfeit = (over: Record<string, unknown>) => ({
      forfeiting_registration_id: 'r1',
      match_id: 'm1',
      reason: 'injury',
      voided_at: null,
      ...over,
    });
    const supabase = mockSupabase({
      exchanges: { rows: [] },
      match_forfeits: {
        rows: [
          forfeit({}),
          forfeit({ match_id: 'm2', reason: 'voluntary' }),
          forfeit({ forfeiting_registration_id: 'r2', match_id: 'm3' }),
          forfeit({ forfeiting_registration_id: 'r2', match_id: 'm3', reason: 'result_override' }),
          forfeit({
            forfeiting_registration_id: 'r2',
            match_id: 'm3',
            voided_at: '2026-08-18T10:00:00.000Z',
          }),
          forfeit({ forfeiting_registration_id: 'r3', match_id: 'm-elsewhere' }),
        ],
      },
    });
    const { forfeitCountByReg } = await loadScoringInputs(as(supabase), ['m1', 'm2', 'm3']);
    expect(forfeitCountByReg.get('r1')).toBe(2);
    expect(forfeitCountByReg.get('r2')).toBe(1);
    expect(forfeitCountByReg.has('r3')).toBe(false);
  });

  it('tolerates null rows from both reads', async () => {
    const supabase = mockSupabase({
      exchanges: { data: null, error: null },
      match_forfeits: { data: null, error: null },
    });
    const result = await loadScoringInputs(as(supabase), ['m1']);
    expect(result.exchangesByMatch.size).toBe(0);
    expect(result.forfeitCountByReg.size).toBe(0);
  });

  it('surfaces an exchanges error as BadRequest', async () => {
    const supabase = mockSupabase({
      exchanges: { data: null, error: { message: 'exchange read failed' } },
      match_forfeits: ok,
    });
    await expect(loadScoringInputs(as(supabase), ['m1'])).rejects.toThrow('exchange read failed');
  });

  it('surfaces a forfeits error as BadRequest', async () => {
    const supabase = mockSupabase({
      exchanges: ok,
      match_forfeits: { data: null, error: { message: 'forfeit read failed' } },
    });
    await expect(loadScoringInputs(as(supabase), ['m1'])).rejects.toThrow('forfeit read failed');
  });
});

describe('resolveTournamentRuleset', () => {
  const ruleset = { standingsColumns: [{ key: 'score' }] };
  const resolver = (resolved: unknown = ruleset): RulesetResolver =>
    ({ resolve: vi.fn().mockResolvedValue(resolved) }) as unknown as RulesetResolver;

  it('resolves and normalises the persisted shorthand version', async () => {
    // A second tournament, on a different ruleset. Reading the wrong row here
    // would score a whole event with an engine nobody chose.
    const supabase = mockSupabase({
      tournaments: {
        rows: [
          { id: 't1', ruleset_code: 'TF_v1', ruleset_version: '1', ruleset_config: { x: 1 } },
          {
            id: 't9',
            ruleset_code: 'Generic_PointsCap',
            ruleset_version: '2.0.0',
            ruleset_config: null,
          },
        ],
      },
    });
    const rulesets = resolver();
    const result = await resolveTournamentRuleset(as(supabase), rulesets, 't1');

    // Tournaments created before the createTournament fix persisted "1"; the
    // registry only answers to "1.0.0".
    expect(rulesets.resolve).toHaveBeenCalledWith('TF_v1', '1.0.0');
    expect(result.version).toBe('1');
    expect(result.columns).toEqual([{ key: 'score' }]);
  });

  it('defaults afterblowMode to full and threads it into runtimeConfig', async () => {
    const supabase = mockSupabase({
      tournaments: {
        data: { ruleset_code: 'TF_v1', ruleset_version: '1.0.0', scoring_config_json: null },
        error: null,
      },
    });
    const result = await resolveTournamentRuleset(as(supabase), resolver(), 't1');
    expect(result.afterblowMode).toBe('full');
    expect(result.runtimeConfig).toEqual({ afterblowMode: 'full' });
  });

  it('honours a deductive afterblowMode', async () => {
    const supabase = mockSupabase({
      tournaments: {
        data: {
          ruleset_code: 'TF_v1',
          ruleset_version: '1.0.0',
          ruleset_config: { targets: 3 },
          scoring_config_json: { afterblowMode: 'deductive' },
        },
        error: null,
      },
    });
    const result = await resolveTournamentRuleset(as(supabase), resolver(), 't1');
    expect(result.afterblowMode).toBe('deductive');
    expect(result.runtimeConfig).toEqual({ targets: 3, afterblowMode: 'deductive' });
  });

  it('treats an unrecognised afterblowMode as full', async () => {
    const supabase = mockSupabase({
      tournaments: {
        data: {
          ruleset_code: 'TF_v1',
          ruleset_version: '1.0.0',
          scoring_config_json: { afterblowMode: 'nonsense' },
        },
        error: null,
      },
    });
    const result = await resolveTournamentRuleset(as(supabase), resolver(), 't1');
    expect(result.afterblowMode).toBe('full');
  });

  it('throws BadRequest on a read error', async () => {
    const supabase = mockSupabase({
      tournaments: { data: null, error: { message: 'read failed' } },
    });
    await expect(resolveTournamentRuleset(as(supabase), resolver(), 't1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws NotFound when the tournament is missing', async () => {
    const supabase = mockSupabase({ tournaments: { data: null, error: null } });
    await expect(resolveTournamentRuleset(as(supabase), resolver(), 'ghost')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws BadRequest when the resolver does not know the ruleset', async () => {
    // Org-authored custom rulesets 400 here rather than silently scoring on a
    // built-in.
    const supabase = mockSupabase({
      tournaments: {
        data: { ruleset_code: 'CUSTOM', ruleset_version: '2.0.0' },
        error: null,
      },
    });
    await expect(resolveTournamentRuleset(as(supabase), resolver(null), 't1')).rejects.toThrow(
      /CUSTOM v2\.0\.0 not registered/,
    );
  });
});
