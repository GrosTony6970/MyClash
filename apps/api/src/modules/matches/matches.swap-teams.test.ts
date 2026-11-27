import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { MatchesService } from './matches.service';

/**
 * The colour swap on a team bout (slice 1b-2).
 *
 * Lyon Blades fight in red and Nantes Rapières in blue. The organiser swaps the colours. A team
 * bout has no Registration on either side, so a swap of the Registration ids alone moved nobody:
 * Lyon stayed red. Each side now moves whole, its team with it.
 */
const BOUT = 'm1';
const LOCK_READ =
  'id, red_registration_id, blue_registration_id, red_team_id, blue_team_id, side_order, locked_at';

function setup(sides: Record<string, unknown>) {
  const db = mockSupabase({
    matches: { rows: [{ id: BOUT, side_order: 'red_left', locked_at: null, ...sides }] },
    exchanges: { rows: [] },
  });
  const scoring = {
    assertNoRecordHolds: vi.fn().mockResolvedValue(undefined),
    recomputeMatchScore: vi.fn().mockResolvedValue({ redScore: 0, blueScore: 0 }),
  };
  const service = new MatchesService(
    db as never,
    scoring as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
  return { db, service };
}

describe('MatchesService.swapFighterColor on a team bout', () => {
  it('moves each team to the other colour', async () => {
    const { db, service } = setup({
      red_registration_id: null,
      blue_registration_id: null,
      red_team_id: 'team-lyon',
      blue_team_id: 'team-nantes',
    });

    await service.swapFighterColor(BOUT);

    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({
      red_registration_id: null,
      blue_registration_id: null,
      red_team_id: 'team-nantes',
      blue_team_id: 'team-lyon',
    });
    expect(selectsFor(db.from, 'matches')[0]).toBe(LOCK_READ);
  });

  it('moves two Fighters as before, and no team', async () => {
    const { db, service } = setup({
      red_registration_id: 'reg-red',
      blue_registration_id: 'reg-blue',
      red_team_id: null,
      blue_team_id: null,
    });

    await service.swapFighterColor(BOUT);

    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({
      red_registration_id: 'reg-blue',
      blue_registration_id: 'reg-red',
      red_team_id: null,
      blue_team_id: null,
    });
  });
});
