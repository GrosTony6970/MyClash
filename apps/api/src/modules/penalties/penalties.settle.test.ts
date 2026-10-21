import { describe, expect, it } from 'vitest';
import { writesTo } from '../../common/testing/supabase-chain';
import { blackCard, setup, type CardPath, type Seed } from './penalties.void-black-card.fixtures';

/**
 * A black card is a cause of its Fighter's status (slice B, migration 0240): the card door writes
 * no status, it asks the status settle once the card and its forfeit are written, with the rules
 * in force it read. Every retry of the door settles too: the tablet's re-send of a card, and a
 * void sent again. A yellow or a red card is no cause. What the settle answers is probe check 16's.
 */

function cardPath(path: CardPath, seed: Seed = {}) {
  return setup({ forfeit: null, cardPath: path, ...seed });
}

type Opened = ReturnType<typeof cardPath>;

/** The referee's card to Blue, from the tablet. */
const sendCard = ({ service }: Opened, card = 'black', clientUuid = 'card-uuid') =>
  service.createPenalty(
    'm1',
    {
      clientUuid,
      sequence: 1,
      registrationId: 'reg-blue',
      directCard: card,
      reason: 'dangerous action',
      occurredAt: '2026-10-20T10:00:00.000Z',
    } as never,
    { staffAccountId: 'staff-1' },
  );

const tablesBefore = (call: Opened['status']['calls'][number] | undefined) =>
  call?.writesBefore.map((write) => `${write.table}:${write.op}`) ?? [];

describe('a black card settles its Fighter', () => {
  it.each<CardPath['first']>(['tournament', 'match', 'none'])(
    'a 1st card of effect "%s": once the card and its forfeit are written, with the rules it read',
    async (first) => {
      const opened = cardPath({ first, second: 'tournament' });

      await sendCard(opened);

      const last = opened.status.calls.at(-1);
      expect(last?.input).toMatchObject({
        registrationId: 'reg-blue',
        tournamentId: 'tournament-1',
        rules: expect.objectContaining({ firstBlackCard: first, secondBlackCard: 'tournament' }),
      });
      expect(tablesBefore(last)).toContain('match_penalties:insert');
      if (first !== 'none') expect(tablesBefore(last)).toContain('match_forfeits:insert');
      expect(writesTo(opened.db, 'registrations')).toEqual([]);
    },
  );

  it('a yellow card settles nobody', async () => {
    const opened = cardPath({ first: 'tournament', second: 'tournament' });

    await sendCard(opened, 'yellow');

    expect(opened.status.calls).toEqual([]);
  });
});

describe('every retry of a card door settles', () => {
  it('the tablet’s re-send of a black card settles again, and writes no status', async () => {
    const saved = blackCard({ client_uuid: 'card-uuid', causes_match_forfeit: true });
    const opened = cardPath({ first: 'tournament', second: 'tournament' }, { cards: [saved] });

    await expect(sendCard(opened)).resolves.toMatchObject({ id: 'card-black' });

    expect(opened.status.calls.map((call) => call.input)).toEqual([
      expect.objectContaining({ registrationId: 'reg-blue', tournamentId: 'tournament-1' }),
    ]);
    expect(writesTo(opened.db, 'match_penalties')).toEqual([]);
    expect(writesTo(opened.db, 'registrations')).toEqual([]);
  });

  it('the re-send of a black card since voided settles nobody', async () => {
    const saved = blackCard({ client_uuid: 'card-uuid', voided: true });
    const opened = cardPath({ first: 'tournament', second: 'tournament' }, { cards: [saved] });

    await sendCard(opened);

    expect(opened.status.calls).toEqual([]);
  });

  it('a black card’s void sent again, the card already voided, settles, then is refused', async () => {
    const { status, undo } = setup({ cards: [blackCard({ voided: true })] });

    await expect(undo()).rejects.toThrow('Penalty is already voided');

    expect(status.calls.map((call) => call.input)).toEqual([
      {
        registrationId: 'reg-blue',
        tournamentId: 'tournament-1',
        actor: expect.any(Object),
        // Its take-back may have put the bout back: the other Fighter, when out, forfeits it.
        boutsPutBack: ['m1'],
      },
    ]);
  });

  it('a yellow card’s void sent again settles nobody', async () => {
    const yellow = blackCard({ id: 'card-yellow', card: 'yellow', voided: true });
    const { status, undo } = setup({ cards: [yellow] });

    await expect(undo('card-yellow')).rejects.toThrow('Penalty is already voided');

    expect(status.calls).toEqual([]);
  });
});
