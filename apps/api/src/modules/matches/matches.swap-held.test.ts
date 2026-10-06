import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { MatchesService } from './matches.service';

/**
 * Ruling 322: the colour swap moves the two Fighters of a bout and counts on
 * the recompute to move the score with them. A bout a forfeit record holds is
 * not recomputed, so the swap asks first and writes nothing when refused.
 */
const BOUT = 'm1';

function setup(holds: boolean) {
  const db = mockSupabase({
    matches: {
      rows: [
        {
          id: BOUT,
          red_registration_id: 'red',
          blue_registration_id: 'blue',
          side_order: 'red_left',
          locked_at: null,
        },
      ],
    },
    exchanges: { rows: [{ id: 'e1', match_id: BOUT, first_striker_color: 'red' }] },
  });
  const writtenWhenAsked: number[] = [];
  const scoring = {
    assertNoRecordHolds: vi.fn(async (_matchId: string) => {
      writtenWhenAsked.push(writesTo(db, 'matches').length + writesTo(db, 'exchanges').length);
      if (holds) throw new BadRequestException('A forfeit holds this match');
    }),
    recomputeMatchScore: vi.fn().mockResolvedValue({ redScore: 0, blueScore: 0 }),
  };
  const service = new MatchesService(
    db as never,
    scoring as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
  return { db, scoring, service, writtenWhenAsked };
}

describe('MatchesService.swapFighterColor — a bout a forfeit record holds (ruling 322)', () => {
  it('is refused before anything is written', async () => {
    const { db, scoring, service } = setup(true);

    await expect(service.swapFighterColor(BOUT)).rejects.toThrow(BadRequestException);

    expect(scoring.assertNoRecordHolds.mock.calls).toEqual([[BOUT]]);
    expect(writesTo(db, 'matches')).toEqual([]);
    expect(writesTo(db, 'exchanges')).toEqual([]);
    expect(scoring.recomputeMatchScore).not.toHaveBeenCalled();
  });

  it('swaps a bout no record holds, and asks before its first write', async () => {
    const { db, scoring, service, writtenWhenAsked } = setup(false);

    await service.swapFighterColor(BOUT);

    expect(writtenWhenAsked).toEqual([0]);
    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({
      red_registration_id: 'blue',
      blue_registration_id: 'red',
    });
    expect(writesTo(db, 'exchanges')[0]?.row).toEqual([{ id: 'e1', first_striker_color: 'blue' }]);
    expect(scoring.recomputeMatchScore).toHaveBeenCalledWith(BOUT);
  });
});
