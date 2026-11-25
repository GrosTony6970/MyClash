import type { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { MatchesService } from './matches.service';

/**
 * The winner of a manual completion (`PATCH matches/:id/status`) is a side key (call 8).
 *
 * Lyon Blades (red) and Nantes Rapières (blue) fight a team Pool bout. An organiser completes it
 * by hand and names Nantes. A team wins into `winner_team_id`, never into the Registration column.
 * The route wrote any uuid as the winner: a team of another bout was stored as this bout's
 * winner. The bout's sides are now read first, and a key that is neither side is refused.
 */
const BOUT = 'm1';
const TEAM_BOUT = {
  id: BOUT,
  status: 'running',
  red_registration_id: null,
  blue_registration_id: null,
  red_team_id: 'team-red',
  blue_team_id: 'team-blue',
  winner_registration_id: null,
  winner_team_id: null,
};
const SIDE_READ = 'red_registration_id, red_team_id, blue_registration_id, blue_team_id';

function setup(bout: Record<string, unknown> = TEAM_BOUT) {
  const db = mockSupabase({ matches: { rows: [bout] } });
  const completion = { onMatchCompleted: vi.fn().mockResolvedValue(undefined) };
  const service = new MatchesService(
    db as never,
    {} as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined,
    completion as never,
  );
  return { db, completion, service };
}

describe('MatchesService.updateStatus: the winner by side (call 8)', () => {
  it('writes a team winner into winner_team_id, then hands off', async () => {
    const { db, completion, service } = setup();

    await service.updateStatus(BOUT, { status: 'completed', winnerSideId: 'team-blue' });

    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({
      status: 'completed',
      winner_registration_id: null,
      winner_team_id: 'team-blue',
    });
    // The sides are read before the write: the read, then the write's own answer.
    expect(selectsFor(db.from, 'matches')).toEqual([SIDE_READ, '*']);
    expect(completion.onMatchCompleted.mock.calls).toEqual([[BOUT]]);
  });

  it('refuses a team of another bout with a 400, and writes nothing', async () => {
    const { db, completion, service } = setup();

    const thrown = await service
      .updateStatus(BOUT, { status: 'completed', winnerSideId: 'team-elsewhere' })
      .then(
        () => null,
        (error: unknown) => error as HttpException,
      );

    expect(thrown?.getStatus()).toBe(400);
    expect(thrown?.message).toMatch(/neither side/);
    expect(db.writes).toEqual([]);
    expect(completion.onMatchCompleted).not.toHaveBeenCalled();
  });

  it('leaves the stored winner when no winner is sent', async () => {
    const { db, service } = setup({ ...TEAM_BOUT, winner_team_id: 'team-red' });

    await service.updateStatus(BOUT, { status: 'completed' });

    const [write] = writesTo(db, 'matches');
    expect(Object.keys(write?.row as Record<string, unknown>).sort()).toEqual([
      'ended_at',
      'status',
      'updated_at',
    ]);
    // No side read: the write's own answer only.
    expect(selectsFor(db.from, 'matches')).toEqual(['*']);
  });

  it('answers 404 when the bout is not found, and writes nothing', async () => {
    const { db, service } = setup();

    await expect(
      service.updateStatus('m-missing', { status: 'completed', winnerSideId: 'team-blue' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(db.writes).toEqual([]);
  });
});
