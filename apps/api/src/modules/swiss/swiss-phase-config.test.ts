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
  it('parses a stored config blob', async () => {
    const supabase = mockSupabase({ phases: { data: { config_json: CONFIG }, error: null } });
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

  it('asks for fought statuses, so a voided bout no longer counts as under way', async () => {
    // `.neq('status','scheduled')` counted VOIDED as under way, and a voided
    // bout is not being fought — it is the one status that is neither scheduled
    // nor in play. An unfinalise was refusable by a bracket whose only activity
    // had already been undone.
    //
    // Asserted on the QUERY because the double returns canned rows without
    // applying filters, so the filter IS the observable behaviour here. Same
    // approach as admin-dashboard-stats.service.test.ts.
    const supabase = mockSupabase({
      phases: {
        data: [
          { id: 'b1', type: 'single_elim', config_json: { seedingStrategy: 'by-swiss-rank' } },
        ],
        error: null,
      },
      matches: { data: [], error: null },
    });
    await hasStartedDownstreamBracket(as(supabase), 't1', 'swiss1');

    const matchesChain = supabase.from.mock.results[1]?.value as {
      in: { mock: { calls: unknown[][] } };
      neq: { mock: { calls: unknown[][] } };
    };
    expect(matchesChain.in.mock.calls).toContainEqual([
      'status',
      ['running', 'paused', 'completed'],
    ]);
    expect(matchesChain.neq.mock.calls).toEqual([]);
  });
});
