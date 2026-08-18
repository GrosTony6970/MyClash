import { ConflictException, ForbiddenException } from '@nestjs/common';
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

/**
 * A matches row whose embed resolves to round 2 of a Swiss phase on `phase-1`,
 * alongside a second Swiss bout from a LATER round of the same phase.
 *
 * The decoy is what makes the id scope decidable. Resolving the wrong bout
 * here would advance from the wrong round.
 */
const swissMatchRow = (embed: unknown = { phase_id: 'phase-1', round_number: 2 }) => ({
  rows: [
    { id: 'm1', swiss_round_id: 'round-1', swiss_rounds: embed },
    {
      id: 'm-later',
      swiss_round_id: 'round-4',
      swiss_rounds: { phase_id: 'phase-1', round_number: 4 },
    },
  ],
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

/**
 * `phase-1` as configured, beside another phase that has been FINALISED.
 *
 * Reading the wrong row here either advances a frozen phase or refuses a live
 * one, so the id scope has something to get wrong in both directions.
 */
const phaseRows = (over: Record<string, unknown> = {}) => ({
  rows: [
    { id: 'phase-1', config_json: config(over) },
    {
      id: 'phase-9',
      config_json: config({
        finalized: { atRound: 3, at: '2026-08-18T10:00:00.000Z', byUserId: null },
      }),
    },
  ],
});

/**
 * The rounds of `phase-1` up to and including round 2, plus the rows a wider
 * read would take: an EARLIER round, and a later round of ANOTHER phase.
 *
 * `hasLaterRound` asks "is there a round drawn after this one", so both decoys
 * would answer yes and stop an advance that should happen.
 */
const roundRows = (later: Array<Record<string, unknown>> = []) => ({
  rows: [
    { id: 'round-0', phase_id: 'phase-1', round_number: 1, status: 'completed', matches: [] },
    { id: 'round-1', phase_id: 'phase-1', round_number: 2, status: 'completed', matches: [] },
    { id: 'round-p9', phase_id: 'phase-9', round_number: 9, status: 'pending', matches: [] },
    ...later,
  ],
});

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
    // `finalized` is the freeze RECORD, not a boolean — a bare `true` fails the
    // .strict() parse, which would leave the phase looking live. The second
    // row is a LIVE phase: reading it instead of this one advances a phase
    // whose standings have already been published.
    const supabase = mockSupabase({
      matches: swissMatchRow(),
      phases: {
        rows: [
          {
            id: 'phase-1',
            config_json: config({
              finalized: {
                atRound: 5,
                at: '2026-08-07T10:00:00.000Z',
                byUserId: '11111111-1111-4111-8111-111111111111',
              },
            }),
          },
          { id: 'phase-9', config_json: config() },
        ],
      },
      swiss_rounds: roundRows(),
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
    // Nothing is drawn after round 2 of THIS phase. The table still holds an
    // earlier round and another phase's later one, either of which would stop
    // the advance if the head count were not scoped.
    const supabase = mockSupabase({
      matches: swissMatchRow(),
      phases: phaseRows(),
      swiss_rounds: roundRows(),
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
      phases: phaseRows(),
      swiss_rounds: roundRows([
        { id: 'round-3', phase_id: 'phase-1', round_number: 3, status: 'pending', matches: [] },
        { id: 'round-4', phase_id: 'phase-1', round_number: 4, status: 'pending', matches: [] },
      ]),
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
      phases: { rows: [{ id: 'phase-1', config_json: { garbage: true } }] },
      swiss_rounds: roundRows(),
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

/**
 * The inverse. Split into an assert and a write on purpose: a refusal raised
 * from the write method would land after `revertMatchToUnplayed` has already
 * run, which is the half-applied cascade the owner's ordering prevents.
 */
describe('SwissAdvanceService un-completion', () => {
  const ORGANISER = { actor: { canDiscardDependentResults: true } };

  it('refuses when a later round has already been drawn', async () => {
    // ANY later round, fought or not. An all-scheduled round N+1 has already
    // been published to the whole field and had pistes assigned, and its
    // pairing came from standings that included the result being undone.
    const supabase = mockSupabase({
      matches: swissMatchRow(),
      swiss_rounds: roundsAhead(1),
    });

    await expect(
      new SwissAdvanceService(
        as(supabase),
        pairingStub(),
        roundStateStub('completed'),
      ).assertUncompletable('m1', {}),
    ).rejects.toThrow(ConflictException);
  });

  it('lets an organiser through once they have acknowledged it', async () => {
    const supabase = mockSupabase({
      matches: swissMatchRow(),
      swiss_rounds: roundsAhead(1),
    });

    await expect(
      new SwissAdvanceService(
        as(supabase),
        pairingStub(),
        roundStateStub('completed'),
      ).assertUncompletable('m1', { ...ORGANISER, discardDependents: true }),
    ).resolves.toBeUndefined();
  });

  it('refuses a pad scorekeeper who acknowledged but cannot discard', async () => {
    const supabase = mockSupabase({
      matches: swissMatchRow(),
      swiss_rounds: roundsAhead(1),
    });

    await expect(
      new SwissAdvanceService(
        as(supabase),
        pairingStub(),
        roundStateStub('completed'),
      ).assertUncompletable('m1', { discardDependents: true, actor: {} }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('does not refuse on the frontier round, where nothing was drawn from it', async () => {
    const supabase = mockSupabase({
      matches: swissMatchRow(),
      swiss_rounds: roundsAhead(0),
    });

    await expect(
      new SwissAdvanceService(
        as(supabase),
        pairingStub(),
        roundStateStub('completed'),
      ).assertUncompletable('m1', {}),
    ).resolves.toBeUndefined();
  });

  it('is a no-op for a non-Swiss match', async () => {
    const supabase = mockSupabase({ matches: { data: { swiss_round_id: null }, error: null } });
    const roundState = roundStateStub('completed');

    await new SwissAdvanceService(as(supabase), pairingStub(), roundState).onMatchUncompleted('m1');

    expect(roundState.refresh).not.toHaveBeenCalled();
  });

  it('re-opens the round, projecting the bout as already unplayed', async () => {
    // The owner runs before its caller's write, so the bout still reads
    // `completed` here — passing the id is what makes the recompute true.
    const supabase = mockSupabase({ matches: swissMatchRow() });
    const roundState = roundStateStub('running');

    await new SwissAdvanceService(as(supabase), pairingStub(), roundState).onMatchUncompleted('m1');

    expect(roundState.refresh).toHaveBeenCalledWith('round-1', 'm1');
  });

  it('swallows a refresh failure — the bout has already been put back', async () => {
    const supabase = mockSupabase({ matches: swissMatchRow() });
    const roundState = {
      refresh: vi.fn().mockRejectedValue(new Error('round state exploded')),
    } as unknown as SwissRoundStateService;

    await expect(
      new SwissAdvanceService(as(supabase), pairingStub(), roundState).onMatchUncompleted('m1'),
    ).resolves.toBeUndefined();
  });
});

describe('SwissAdvanceService.roundsAhead', () => {
  /**
   * `hasFoughtBout` had no test, and it is not internal bookkeeping: it reaches
   * the organiser as the warning copy on the un-completion confirm dialog (see
   * uncomplete-confirm-copy.ts in web-admin). These pin the answer per status so
   * the shared predicate cannot be swapped underneath it unnoticed.
   */
  /**
   * Round 4 of this phase, holding `matches`, beside the rows a wider read
   * would take: round 1, which is BEHIND the bout being asked about, and
   * another phase's round entirely.
   */
  const laterRound = (matches: Array<{ status: string; started_at: string | null }>) => ({
    rows: [
      { id: 'round-0', phase_id: 'phase-1', round_number: 1, status: 'completed', matches: [] },
      { id: 'round-4', phase_id: 'phase-1', round_number: 4, status: 'pending', matches },
      { id: 'round-p9', phase_id: 'phase-9', round_number: 9, status: 'pending', matches: [] },
    ],
  });

  const ask = async (matches: Array<{ status: string; started_at: string | null }>) => {
    const supabase = mockSupabase({
      matches: swissMatchRow(),
      swiss_rounds: laterRound(matches),
    });
    return new SwissAdvanceService(as(supabase), pairingStub(), roundStateStub('running'))
      .roundsAhead('m1')
      .then((rounds) => rounds[0]?.hasFoughtBout);
  };

  it('reports only the rounds of this phase drawn AFTER this one, in order', async () => {
    // The bout under test is in round 2. Round 1 is behind it, round 9 belongs
    // to another phase, and neither is something un-completing round 2 would
    // disturb. The two that qualify come back lowest round first, because the
    // organiser reads them as a list of what they are about to undo.
    const supabase = mockSupabase({
      matches: swissMatchRow(),
      swiss_rounds: {
        rows: [
          { id: 'round-5', phase_id: 'phase-1', round_number: 5, status: 'pending', matches: [] },
          { id: 'round-0', phase_id: 'phase-1', round_number: 1, status: 'completed', matches: [] },
          { id: 'round-3', phase_id: 'phase-1', round_number: 3, status: 'pending', matches: [] },
          { id: 'round-p9', phase_id: 'phase-9', round_number: 9, status: 'pending', matches: [] },
        ],
      },
    });

    const rounds = await new SwissAdvanceService(
      as(supabase),
      pairingStub(),
      roundStateStub('running'),
    ).roundsAhead('m1');

    expect(rounds.map((r) => r.roundNumber)).toEqual([3, 5]);
  });

  it('reports a round holding a running, paused or completed bout as fought', async () => {
    await expect(ask([{ status: 'running', started_at: null }])).resolves.toBe(true);
    await expect(ask([{ status: 'paused', started_at: null }])).resolves.toBe(true);
    await expect(ask([{ status: 'completed', started_at: null }])).resolves.toBe(true);
  });

  it('does not report a round of scheduled bouts as fought', async () => {
    await expect(ask([{ status: 'scheduled', started_at: null }])).resolves.toBe(false);
  });

  it('does not let a voided bout make a round look fought', async () => {
    // Excluded before the predicate is asked, the way the bracket callers do it:
    // a voided bout carries `started_at` if it ever ran, and hasBeenFought says
    // true for it. A round whose only activity was voided has not been drawn
    // into, and must not block un-completing an earlier one.
    await expect(ask([{ status: 'voided', started_at: '2026-05-21T10:00:00.000Z' }])).resolves.toBe(
      false,
    );
  });

  it('reads the whole round, not just its first bout', async () => {
    await expect(
      ask([
        { status: 'scheduled', started_at: null },
        { status: 'completed', started_at: null },
      ]),
    ).resolves.toBe(true);
  });
});
