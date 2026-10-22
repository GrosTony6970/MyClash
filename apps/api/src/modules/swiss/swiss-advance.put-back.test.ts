import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import type { SwissPairingService } from './swiss-pairing.service';
import { SwissRoundStateService } from './swiss-round-state.service';
import { SwissAdvanceService } from './swiss-advance.service';
import { asSupabase as as } from './swiss.fixtures';

/**
 * A bout put back by a take-back or a Fighter's return (slice B-Swiss): its round's status follows
 * the bouts AS THEY ARE. Not the un-completion's projection, which reads the bout as unplayed
 * before its caller writes it: here the bout is written already, and some bouts handed in were not
 * put back at all — a black card taken back on a bout that finished by play, a void that restored
 * a completed result. Through the real round-state owner on seeded rows.
 */
const roundOf = (boutStatuses: string[], status = 'completed') =>
  mockSupabase({
    matches: {
      rows: [
        { id: 'm1', swiss_round_id: 'round-1', swiss_rounds: { phase_id: 'p1', round_number: 1 } },
      ],
    },
    swiss_rounds: {
      rows: [
        {
          id: 'round-1',
          status,
          matches: boutStatuses.map((bout, i) => ({ id: `m${i + 1}`, status: bout })),
        },
      ],
    },
  });

const advanceOver = (supabase: ReturnType<typeof roundOf>) =>
  new SwissAdvanceService(
    as(supabase),
    {} as SwissPairingService,
    new SwissRoundStateService(as(supabase)),
  );

describe('SwissAdvanceService.onBoutPutBack', () => {
  it('keeps a round whose bouts are all finished completed', async () => {
    // The card's bout finished by play: nothing was put back.
    const supabase = roundOf(['completed', 'completed']);
    await advanceOver(supabase).onBoutPutBack('m1');
    expect(writesTo(supabase, 'swiss_rounds')).toEqual([]);
  });

  it('reopens a round whose bout is back on', async () => {
    const supabase = roundOf(['scheduled', 'completed']);
    await advanceOver(supabase).onBoutPutBack('m1');
    // One bout back on beside one fought: the round is under way again.
    expect(writesTo(supabase, 'swiss_rounds')[0]?.row).toEqual({ status: 'running' });
  });

  it('is a no-op for a bout of no Swiss round', async () => {
    const supabase = mockSupabase({ matches: { data: { swiss_round_id: null }, error: null } });
    const roundState = { refresh: vi.fn() } as unknown as SwissRoundStateService;
    await new SwissAdvanceService(
      as(supabase),
      {} as SwissPairingService,
      roundState,
    ).onBoutPutBack('m1');
    expect(roundState.refresh).not.toHaveBeenCalled();
  });

  it('swallows a refresh failure: the bout is put back already', async () => {
    const supabase = roundOf(['scheduled']);
    const roundState = {
      refresh: vi.fn().mockRejectedValue(new Error('round state exploded')),
    } as unknown as SwissRoundStateService;
    await expect(
      new SwissAdvanceService(as(supabase), {} as SwissPairingService, roundState).onBoutPutBack(
        'm1',
      ),
    ).resolves.toBeUndefined();
  });
});
