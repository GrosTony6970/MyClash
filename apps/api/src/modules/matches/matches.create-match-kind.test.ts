import type { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { MatchesService } from './matches.service';

/**
 * The manual bout create in a team Tournament (call 8).
 *
 * The route (`POST phases/:phaseId/matches`) names its two sides by Registration, and no screen
 * calls it. A team Tournament's bouts have a team on each side, so a bout made here would name
 * nobody. It is refused 409 with the reason of 1b-1, `team_tournament_not_supported`, before the
 * piste is checked and before anything is written.
 */
const DTO = {
  phaseId: 'phase-1',
  liceId: 'lice-1',
  redRegistrationId: 'r',
  blueRegistrationId: 'b',
};

function setup(entrantKind: unknown) {
  const db = mockSupabase({
    phases: {
      rows: [{ id: 'phase-1', tournament_id: 't-1', tournaments: { entrant_kind: entrantKind } }],
    },
    matches: { rows: [] },
  });
  const placement = { placeMatches: vi.fn().mockResolvedValue(undefined) };
  const service = new MatchesService(
    db as never,
    {} as never,
    { refresh: vi.fn().mockResolvedValue(undefined) } as never,
    placement as never,
    {} as never,
  );
  return { db, placement, service };
}

const refusalOf = (attempt: Promise<unknown>) =>
  attempt.then(
    () => null,
    (error: unknown) => error as HttpException,
  );

describe('createMatch in a team Tournament (call 8)', () => {
  it('is refused 409 team_tournament_not_supported, before anything is placed or written', async () => {
    const { db, placement, service } = setup('team');

    const thrown = await refusalOf(service.createMatch(DTO as never));

    expect(thrown?.getStatus()).toBe(409);
    // Its own sentence: the bracket and Swiss one says a team Tournament runs Pools, which reads
    // as an invitation on a bout refused inside a team Pool.
    expect(thrown?.getResponse()).toEqual({
      reason: 'team_tournament_not_supported',
      message: 'A bout of a team Tournament is not made by hand: its Pools make their bouts.',
    });
    expect(placement.placeMatches).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
    expect(selectsFor(db.from, 'phases')).toEqual(['id, tournaments!inner(entrant_kind)']);
  });

  it('refuses a phase whose kind was not read, rather than pass it for individual', async () => {
    const { db, service } = setup(undefined);

    await expect(service.createMatch(DTO as never)).rejects.toThrow(/kind was not read/);
    expect(db.writes).toEqual([]);
  });

  it('answers 404 for a phase it cannot find, and writes nothing', async () => {
    const { db, service } = setup('individual');

    const thrown = await refusalOf(
      service.createMatch({ ...DTO, phaseId: 'phase-missing' } as never),
    );

    expect(thrown?.getStatus()).toBe(404);
    expect(db.writes).toEqual([]);
  });
});
