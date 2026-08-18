import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { mockSupabase, queriedTables } from '../../common/testing/supabase-chain';
import type { SupabaseService } from '../supabase/supabase.service';
import {
  DEFAULT_SWISS_POINTS,
  DEFAULT_SWISS_TIEBREAK_CHAIN,
  type SwissConfig,
} from './dto/swiss-config.dto';
import {
  hasStartedDownstreamBracket,
  readSwissConfig,
  writeSwissConfig,
} from './swiss-phase-config';

const as = (supabase: { service: unknown }): SupabaseService =>
  supabase as unknown as SupabaseService;

/** A config that actually satisfies swissConfigSchema — readSwissConfig parses. */
const CONFIG: SwissConfig = {
  roundCount: 5,
  seedingStrategy: 'random',
  pairingMethod: 'fold',
  grouping: { kind: 'points' },
  rankBy: 'swissPts',
  points: { ...DEFAULT_SWISS_POINTS },
  tiebreakChain: [...DEFAULT_SWISS_TIEBREAK_CHAIN],
};

describe('writeSwissConfig', () => {
  it('resolves when the update matched a row', async () => {
    const supabase = mockSupabase({ phases: { data: { id: 'p1' }, error: null } });
    await expect(writeSwissConfig(as(supabase), 'p1', CONFIG)).resolves.toBeUndefined();
    expect(queriedTables(supabase.from)).toEqual(['phases']);
  });

  it('throws BadRequest on a database error', async () => {
    const supabase = mockSupabase({ phases: { data: null, error: { message: 'boom' } } });
    await expect(writeSwissConfig(as(supabase), 'p1', CONFIG)).rejects.toThrow(BadRequestException);
    await expect(writeSwissConfig(as(supabase), 'p1', CONFIG)).rejects.toThrow('boom');
  });

  it('throws NotFound when the WHERE matched nothing', async () => {
    // The fail-loud branch that matters: an update persisting zero rows used to
    // return 200 with nothing written.
    const supabase = mockSupabase({ phases: { data: null, error: null } });
    await expect(writeSwissConfig(as(supabase), 'ghost', CONFIG)).rejects.toThrow(
      NotFoundException,
    );
    await expect(writeSwissConfig(as(supabase), 'ghost', CONFIG)).rejects.toThrow(/ghost/);
  });

  it('prefers the error branch when a row came back alongside an error', async () => {
    const supabase = mockSupabase({ phases: { data: { id: 'p1' }, error: { message: 'nope' } } });
    await expect(writeSwissConfig(as(supabase), 'p1', CONFIG)).rejects.toThrow(BadRequestException);
  });
});

describe('readSwissConfig', () => {
  it('parses the stored config of the phase it was asked for', async () => {
    // A second Swiss phase, configured differently. Reading the wrong row here
    // pairs a round by the wrong method over the wrong number of rounds.
    const supabase = mockSupabase({
      phases: {
        rows: [
          { id: 'p1', config_json: CONFIG },
          { id: 'p2', config_json: { ...CONFIG, roundCount: 9, pairingMethod: 'adjacent' } },
        ],
      },
    });
    await expect(readSwissConfig(as(supabase), 'p1')).resolves.toMatchObject({
      roundCount: 5,
      pairingMethod: 'fold',
    });
  });

  it('returns null for a blob the schema rejects, rather than throwing', async () => {
    // The schema is .strict(), so a typo'd key fails the whole parse. Read paths
    // render "misconfigured" instead of 500-ing the tournament page.
    const supabase = mockSupabase({
      phases: { data: { config_json: { ...CONFIG, pairingMehtod: 'adjacent' } }, error: null },
    });
    await expect(readSwissConfig(as(supabase), 'p1')).resolves.toBeNull();
  });

  it('returns null when the phase row is gone', async () => {
    const supabase = mockSupabase({ phases: { data: null, error: null } });
    await expect(readSwissConfig(as(supabase), 'ghost')).resolves.toBeNull();
  });

  it('returns null when the phase has no config_json at all', async () => {
    const supabase = mockSupabase({ phases: { data: {}, error: null } });
    await expect(readSwissConfig(as(supabase), 'p1')).resolves.toBeNull();
  });

  it('returns null for a config blob that does not parse', async () => {
    const supabase = mockSupabase({
      phases: { data: { config_json: 'not-an-object' }, error: null },
    });
    await expect(readSwissConfig(as(supabase), 'p1')).resolves.toBeNull();
  });
});

describe('hasStartedDownstreamBracket', () => {
  it('is false when the tournament has no elimination phases', async () => {
    const supabase = mockSupabase({ phases: { data: [], error: null } });
    await expect(hasStartedDownstreamBracket(as(supabase), 't1', 'swiss1')).resolves.toBe(false);
    // Never reaches matches — an unconfigured table would have thrown.
    expect(queriedTables(supabase.from)).toEqual(['phases']);
  });

  it('is false when phases is null rather than an empty array', async () => {
    const supabase = mockSupabase({ phases: { data: null, error: null } });
    await expect(hasStartedDownstreamBracket(as(supabase), 't1', 'swiss1')).resolves.toBe(false);
  });

  it('ignores brackets seeded from something other than this Swiss phase', async () => {
    const supabase = mockSupabase({
      phases: {
        data: [
          { id: 'b1', type: 'single_elim', config_json: { seedingStrategy: 'manual' } },
          { id: 'b2', type: 'double_elim', config_json: { sourcePhaseId: 'other-swiss' } },
        ],
        error: null,
      },
    });
    await expect(hasStartedDownstreamBracket(as(supabase), 't1', 'swiss1')).resolves.toBe(false);
    expect(queriedTables(supabase.from)).toEqual(['phases']);
  });

  it('treats a missing config_json as not seeded from Swiss', async () => {
    const supabase = mockSupabase({
      phases: { data: [{ id: 'b1', type: 'single_elim' }], error: null },
    });
    await expect(hasStartedDownstreamBracket(as(supabase), 't1', 'swiss1')).resolves.toBe(false);
  });

  it('is false when a Swiss-seeded bracket exists but nothing has started', async () => {
    const supabase = mockSupabase({
      phases: {
        data: [
          { id: 'b1', type: 'single_elim', config_json: { seedingStrategy: 'by-swiss-rank' } },
        ],
        error: null,
      },
      matches: { data: [], error: null },
    });
    await expect(hasStartedDownstreamBracket(as(supabase), 't1', 'swiss1')).resolves.toBe(false);
    expect(queriedTables(supabase.from)).toEqual(['phases', 'matches']);
  });

  it('is true when a by-swiss-rank bracket has a bout under way', async () => {
    const supabase = mockSupabase({
      phases: {
        data: [
          { id: 'b1', type: 'single_elim', config_json: { seedingStrategy: 'by-swiss-rank' } },
        ],
        error: null,
      },
      matches: { data: [{ id: 'm1' }], error: null },
    });
    await expect(hasStartedDownstreamBracket(as(supabase), 't1', 'swiss1')).resolves.toBe(true);
  });

  it('ignores a started bracket belonging to another tournament', async () => {
    // One event runs several tournaments, each with its own Swiss and its own
    // bracket. Reading past this tournament would freeze an organiser out of
    // resuming their phase because somebody else's bracket had started.
    const supabase = mockSupabase({
      phases: {
        rows: [
          {
            id: 'b1',
            tournament_id: 't1',
            type: 'single_elim',
            config_json: { seedingStrategy: 'by-swiss-rank' },
          },
          {
            id: 'b9',
            tournament_id: 't9',
            type: 'single_elim',
            config_json: { seedingStrategy: 'by-swiss-rank' },
          },
        ],
      },
      matches: {
        rows: [
          { id: 'm1', phase_id: 'b1', status: 'scheduled' },
          { id: 'm9', phase_id: 'b9', status: 'completed' },
        ],
      },
    });

    await expect(hasStartedDownstreamBracket(as(supabase), 't1', 'swiss1')).resolves.toBe(false);
  });

  it('matches on sourcePhaseId as well as seedingStrategy', async () => {
    const supabase = mockSupabase({
      phases: {
        data: [{ id: 'b1', type: 'double_elim', config_json: { sourcePhaseId: 'swiss1' } }],
        error: null,
      },
      matches: { data: [{ id: 'm1' }], error: null },
    });
    await expect(hasStartedDownstreamBracket(as(supabase), 't1', 'swiss1')).resolves.toBe(true);
  });

  it('keeps scanning after an unstarted bracket and reports a later started one', async () => {
    // Ordered per table, so the first bracket sees the empty result and the
    // second sees the started one — the loop's continue path.
    const supabase = mockSupabase({
      phases: {
        data: [
          { id: 'b1', type: 'single_elim', config_json: { seedingStrategy: 'by-swiss-rank' } },
          { id: 'b2', type: 'double_elim', config_json: { sourcePhaseId: 'swiss1' } },
        ],
        error: null,
      },
      matches: [
        { data: [], error: null },
        { data: [{ id: 'm9' }], error: null },
      ],
    });
    await expect(hasStartedDownstreamBracket(as(supabase), 't1', 'swiss1')).resolves.toBe(true);
    expect(queriedTables(supabase.from)).toEqual(['phases', 'matches', 'matches']);
  });

  it('treats a null matches result as not started', async () => {
    const supabase = mockSupabase({
      phases: {
        data: [
          { id: 'b1', type: 'single_elim', config_json: { seedingStrategy: 'by-swiss-rank' } },
        ],
        error: null,
      },
      matches: { data: null, error: null },
    });
    await expect(hasStartedDownstreamBracket(as(supabase), 't1', 'swiss1')).resolves.toBe(false);
  });

  /**
   * `.neq('status','scheduled')` counted VOIDED as under way, and a voided bout
   * is not being fought — it is the one status that is neither scheduled nor in
   * play. An unfinalise was refusable by a bracket whose only activity had
   * already been undone.
   *
   * Seeded as `rows`, so these assert what the caller answers rather than which
   * filter it asked for. `phases` stays canned on purpose: its fixture row has
   * no `tournament_id`, so under `rows` the `.eq('tournament_id', …)` would
   * filter it away and both cases would pass through the no-bracket branch
   * without ever reaching a match.
   */
  const bracketWithMatches = (matches: Record<string, unknown>[]) =>
    mockSupabase({
      phases: {
        data: [
          { id: 'b1', type: 'single_elim', config_json: { seedingStrategy: 'by-swiss-rank' } },
        ],
        error: null,
      },
      matches: { rows: matches },
    });

  it('counts a bracket as started when a bout beside the voided one was fought', async () => {
    const supabase = bracketWithMatches([
      { id: 'm1', phase_id: 'b1', status: 'voided' },
      { id: 'm2', phase_id: 'b1', status: 'completed' },
    ]);
    await expect(hasStartedDownstreamBracket(as(supabase), 't1', 'swiss1')).resolves.toBe(true);
  });

  it('does not count a bracket whose only activity was voided', async () => {
    const supabase = bracketWithMatches([
      { id: 'm1', phase_id: 'b1', status: 'voided' },
      { id: 'm2', phase_id: 'b1', status: 'scheduled' },
    ]);
    await expect(hasStartedDownstreamBracket(as(supabase), 't1', 'swiss1')).resolves.toBe(false);
  });
});
