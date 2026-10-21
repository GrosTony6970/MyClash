import { describe, expect, it } from 'vitest';
import { writesTo } from '../../common/testing/supabase-chain';
import { cardsPutOut } from '../matches/fighter-status.fixtures';
import {
  AFTER_THE_CARD,
  setup,
  settles,
  type CardPath,
} from './penalties.void-black-card.fixtures';

/**
 * Ruling 57: a black card that reaches the Tournament forfeits the Fighter's remaining Pool
 * bouts, whenever it is given. Given on a bout already over (a referee's card after the final
 * hit), the card ends nothing: that bout is decided. Before slice B2 the card was saved, its
 * forfeit refused with a 400 ("Match is already closed"), and the pad filed the card as refused;
 * only the tablet's automatic re-send settled the Fighter.
 *
 * Through the real `PenaltiesService` over the real `MatchForfeitsService`. What the settle then
 * does to her bouts is the reconcile's (`fighter-reconcile.out.test.ts`).
 */

const sendCard = (bout: ReturnType<typeof setup>) =>
  bout.service.createPenalty(
    'm1',
    {
      clientUuid: 'card-uuid',
      sequence: 1,
      registrationId: 'reg-blue',
      directCard: 'black',
      reason: 'dangerous action',
      occurredAt: '2026-10-20T10:00:00.000Z',
    } as never,
    { staffAccountId: 'staff-1' },
  );

const over = (path: CardPath) =>
  setup({ forfeit: null, cardPath: path, bout: { ...AFTER_THE_CARD, pool_id: 'pool-1' } });

describe('a black card given on a bout already over (ruling 57)', () => {
  it('is saved, ends nothing on its bout, and settles her for the scorer', async () => {
    const bout = over({ first: 'tournament', second: 'tournament' });

    await expect(sendCard(bout)).resolves.toBeDefined();

    expect(writesTo(bout.db, 'match_penalties').map((write) => write.op)).toEqual(['insert']);
    expect(writesTo(bout.db, 'match_forfeits')).toEqual([]);
    expect(writesTo(bout.db, 'matches')).toEqual([]);
    expect(settles(bout.status)).toEqual([
      {
        registrationId: 'reg-blue',
        tournamentId: 'tournament-1',
        after: ['match_penalties:insert'],
      },
    ]);
    expect(bout.status.calls[0]!.input.actor).toEqual({
      userId: undefined,
      staffAccountId: 'staff-1',
    });
    expect(cardsPutOut(bout)).toMatchObject({ firstCardOut: true });
  });

  it('a card that only ends its bout is saved and settles her too: there is nothing to end', async () => {
    const bout = over({ first: 'match', second: 'match' });

    await expect(sendCard(bout)).resolves.toBeDefined();

    expect(writesTo(bout.db, 'match_forfeits')).toEqual([]);
    expect(bout.status.calls).toHaveLength(1);
  });

  it('on a bout still running, the card still ends it with its forfeit', async () => {
    const bout = setup({ forfeit: null, cardPath: { first: 'tournament', second: 'tournament' } });

    await sendCard(bout);

    expect(writesTo(bout.db, 'match_forfeits').filter((w) => w.op === 'insert')).toHaveLength(1);
  });
});
