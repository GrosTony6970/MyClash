import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, queriedTables } from '../../common/testing/supabase-chain';
import type { SupabaseService } from '../supabase/supabase.service';
import type { SwissPairingService } from './swiss-pairing.service';
import type { SwissRoundStateService } from './swiss-round-state.service';
import { DEFAULT_SWISS_POINTS, DEFAULT_SWISS_TIEBREAK_CHAIN } from './dto/swiss-config.dto';
import { SwissAdvanceService } from './swiss-advance.service';

const as = (supabase: { service: unknown }): SupabaseService =>
  supabase as unknown as SupabaseService;

const config = (over: Record<string, unknown> = {}) => ({
  roundCount: 5,
  seedingStrategy: 'random',
  pairingMethod: 'fold',
  grouping: { kind: 'points' },
  rankBy: 'swissPts',
  points: { ...DEFAULT_SWISS_POINTS },
  tiebreakChain: [...DEFAULT_SWISS_TIEBREAK_CHAIN],
  ...over,
});

const pairingStub = (committed: unknown = null) =>
  ({ commitNextRound: vi.fn().mockResolvedValue(committed) }) as unknown as SwissPairingService;

const roundStateStub = (status: string) =>
  ({ refresh: vi.fn().mockResolvedValue(status) }) as unknown as SwissRoundStateService;

/** A matches row whose embed resolves to round 2 of a Swiss phase on `phase-1`. */
const swissMatchRow = (embed: unknown = { phase_id: 'phase-1', round_number: 2 }) => ({
  data: { swiss_round_id: 'round-1', swiss_rounds: embed },
  error: null,
});

/**
 * The frontier head-count. `count` is what the service reads; `data` is present
 * only because the double resolves one object for both spellings.
 *
 * Configured explicitly in every test that gets far enough to ask, because
 * `supabaseFrom` throws on an unconfigured table and `onMatchCompleted` swallows
 * throws — an omission here would read as a passing "did not advance".
 */
const roundsAhead = (count: number) => ({ data: [], count, error: null });

describe('SwissAdvanceService.onMatchCompleted', () => {
  it('does nothing when the optional collaborators are absent', async () => {
    // Both are @Optional(); without them the service must not even read.
    const supabase = mockSupabase({});
    const service = new SwissAdvanceService(as(supabase));
    await expect(service.onMatchCompleted('m1')).resolves.toBeUndefined();
    expect(queriedTables(supabase.from)).toEqual([]);
  });

  it('is a no-op for a non-Swiss match', async () => {
    const supabase = mockSupabase({ matches: { data: { swiss_round_id: null }, error: null } });
    const pairing = pairingStub();
    const roundState = roundStateStub('completed');
    await new SwissAdvanceService(as(supabase), pairing, roundState).onMatchCompleted('m1');

    expect(roundState.refresh).not.toHaveBeenCalled();
    expect(pairing.commitNextRound).not.toHaveBeenCalled();
    expect(queriedTables(supabase.from)).toEqual(['matches']);
  });

  it('is a no-op when the match row is missing entirely', async () => {
    const supabase = mockSupabase({ matches: { data: null, error: null } });
    const pairing = pairingStub();
    await new SwissAdvanceService(
      as(supabase),
      pairing,
      roundStateStub('completed'),
    ).onMatchCompleted('m1');
    expect(pairing.commitNextRound).not.toHaveBeenCalled();
  });

  it('is a no-op when the round embed carries no phase_id', async () => {
    const supabase = mockSupabase({ matches: swissMatchRow(null) });
    const pairing = pairingStub();
    await new SwissAdvanceService(
      as(supabase),
      pairing,
      roundStateStub('completed'),
    ).onMatchCompleted('m1');
    expect(pairing.commitNextRound).not.toHaveBeenCalled();
  });

  it('normalises an array-shaped embed to its first element', async () => {
    // PostgREST flips a many-to-one embed between object and array depending on
    // the key it infers; the service tolerates both on purpose.
    const supabase = mockSupabase({
      matches: swissMatchRow([{ phase_id: 'phase-1', round_number: 2 }]),
      phases: { data: { config_json: config() }, error: null },
      swiss_rounds: roundsAhead(0),
    });
    const pairing = pairingStub({ roundNumber: 2 });
    await new SwissAdvanceService(
      as(supabase),
      pairing,
      roundStateStub('completed'),
    ).onMatchCompleted('m1');
    expect(pairing.commitNextRound).toHaveBeenCalledWith('phase-1');
  });

  it('waits when the round is not yet complete', async () => {
    const supabase = mockSupabase({ matches: swissMatchRow() });
    const pairing = pairingStub();
    await new SwissAdvanceService(
      as(supabase),
      pairing,
      roundStateStub('in_progress'),
    ).onMatchCompleted('m1');

    expect(pairing.commitNextRound).not.toHaveBeenCalled();
    // Never reaches the phases read — an unconfigured table would have thrown.
    expect(queriedTables(supabase.from)).toEqual(['matches']);
  });

  it('refuses to advance a finalised phase', async () => {
    // Advancing would silently unfreeze standings the organiser has published.
    const supabase = mockSupabase({
      matches: swissMatchRow(),
      phases: {
        // `finalized` is the freeze RECORD, not a boolean — a bare `true` fails
        // the .strict() parse, which would leave the phase looking live.
        data: {
          config_json: config({
            finalized: {
              atRound: 5,
              at: '2026-08-07T10:00:00.000Z',
              byUserId: '11111111-1111-4111-8111-111111111111',
            },
          }),
        },
        error: null,
      },
    });
    const pairing = pairingStub({ roundNumber: 2 });
    await new SwissAdvanceService(
      as(supabase),
      pairing,
      roundStateStub('completed'),
    ).onMatchCompleted('m1');
    expect(pairing.commitNextRound).not.toHaveBeenCalled();
  });

  it('advances when the round closed and the phase is live', async () => {
    const supabase = mockSupabase({
      matches: swissMatchRow(),
      phases: { data: { config_json: config() }, error: null },
      swiss_rounds: roundsAhead(0),
    });
    const pairing = pairingStub({ roundNumber: 3 });
    await new SwissAdvanceService(
      as(supabase),
      pairing,
      roundStateStub('completed'),
    ).onMatchCompleted('m1');
    expect(pairing.commitNextRound).toHaveBeenCalledWith('phase-1');
  });

  it('does not advance from a round that is no longer the frontier', async () => {
    // THE SKIPPED-ROUND DEFECT. `planNextRound` computes `rounds.length + 1`
    // over every round the phase has — "one past however many exist", not "the
    // one after this". So re-closing round 2 while rounds 3 and 4 are already
    // drawn commits round 5, schedules pistes for it, and pushes
    // `swiss_round_published` at a field that has not fought round 3 yet.
    //
    // Reachable with no un-completion at all: `PATCH /matches/:id/status` on an
    // already-completed bout runs this whole path a second time.
    const supabase = mockSupabase({
      matches: swissMatchRow(),
      phases: { data: { config_json: config() }, error: null },
      swiss_rounds: roundsAhead(2),
    });
    const pairing = pairingStub({ roundNumber: 5 });
    await new SwissAdvanceService(
      as(supabase),
      pairing,
      roundStateStub('completed'),
    ).onMatchCompleted('m1');

    expect(pairing.commitNextRound).not.toHaveBeenCalled();
  });

  it('treats an unparseable phase config as not finalised', async () => {
    const supabase = mockSupabase({
      matches: swissMatchRow(),
      phases: { data: { config_json: { garbage: true } }, error: null },
      swiss_rounds: roundsAhead(0),
    });
    const pairing = pairingStub({ roundNumber: 2 });
    await new SwissAdvanceService(
      as(supabase),
      pairing,
      roundStateStub('completed'),
    ).onMatchCompleted('m1');
    expect(pairing.commitNextRound).toHaveBeenCalled();
  });

  it('tolerates commitNextRound returning null (phase exhausted or raced)', async () => {
    const supabase = mockSupabase({
      matches: swissMatchRow(),
      phases: { data: { config_json: config() }, error: null },
      swiss_rounds: roundsAhead(0),
    });
    const pairing = pairingStub(null);
    await expect(
      new SwissAdvanceService(as(supabase), pairing, roundStateStub('completed')).onMatchCompleted(
        'm1',
      ),
    ).resolves.toBeUndefined();
  });

  it('swallows a pairing failure instead of failing the completion that triggered it', async () => {
    // The bout is already scored. Throwing here would lose it to a pairing bug.
    const supabase = mockSupabase({
      matches: swissMatchRow(),
      phases: { data: { config_json: config() }, error: null },
      swiss_rounds: roundsAhead(0),
    });
    const pairing = {
      commitNextRound: vi.fn().mockRejectedValue(new Error('pairing exploded')),
    } as unknown as SwissPairingService;
    await expect(
      new SwissAdvanceService(as(supabase), pairing, roundStateStub('completed')).onMatchCompleted(
        'm1',
      ),
    ).resolves.toBeUndefined();
  });

  it('swallows a non-Error rejection too', async () => {
    const supabase = mockSupabase({ matches: swissMatchRow() });
    const roundState = {
      refresh: vi.fn().mockRejectedValue('a bare string'),
    } as unknown as SwissRoundStateService;
    await expect(
      new SwissAdvanceService(as(supabase), pairingStub(), roundState).onMatchCompleted('m1'),
    ).resolves.toBeUndefined();
  });
});
