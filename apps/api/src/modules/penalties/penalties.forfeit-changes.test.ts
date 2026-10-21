import { describe, expect, it } from 'vitest';
import { selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { ForfeitRulesInvalidError } from './forfeit-rules-in-force';
import { cardsPutOut } from '../matches/fighter-status.fixtures';
import { blackCard, setup, type CardPath, type Seed } from './penalties.void-black-card.fixtures';

/**
 * A Tournament may change the forfeit rules of its penalty ruleset, the two black card settings
 * included (rulings 65 and 69, 2026-10-20). Its changes are read beside its pin, in one read, and
 * laid over the ruleset's rules at every door: a card in the bout, the same card sent again, and a
 * card forfeit recorded by hand. A stored change that does not parse refuses, as the rules do.
 *
 * A real `PenaltiesService` over a real `MatchForfeitsService`, as `penalties.card-effect.test.ts`.
 */

const RULESET_SECOND_OUT: CardPath = { first: 'match', second: 'tournament' };
const SECOND_CARD = [blackCard(), blackCard({ id: 'card-black-2' })];
/** The 2nd black card the server already holds, as the tablet sends it again. */
const SAVED_SECOND = blackCard({
  id: 'card-black-2',
  client_uuid: 'card-uuid',
  causes_match_forfeit: true,
});

function opened(path: CardPath, changes: Record<string, unknown> | null, seed: Seed = {}) {
  return setup({ forfeit: null, cardPath: { ...path, changes: changes ?? undefined }, ...seed });
}

type Opened = ReturnType<typeof opened>;

const sendCard = ({ service }: Opened) =>
  service.createPenalty(
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

const recordForfeit = ({ forfeits }: Opened, reason: string) =>
  forfeits.createForfeit(
    'm1',
    { forfeitingRegistrationId: 'reg-blue', reason, canContinue: true } as never,
    { staffAccountId: 'staff-1' },
  );

const inserted = (db: Opened['db']) =>
  writesTo(db, 'match_forfeits')
    .filter((write) => write.op === 'insert')
    .map((write) => write.row as Record<string, unknown>);
const fighterStates = (db: Opened['db']) => writesTo(db, 'registrations').map((write) => write.row);
const reviewOps = (db: Opened['db']) =>
  writesTo(db, 'tournament_penalty_reviews').map((write) => write.op);

describe('a Tournament’s 2nd black card change over its ruleset’s, at every door', () => {
  const ENDS_THE_BOUT = { secondBlackCard: 'match' };

  it('in the bout: the 2nd card ends the bout only, and the review opens', async () => {
    const bout = opened(RULESET_SECOND_OUT, ENDS_THE_BOUT, { cards: SECOND_CARD });

    await sendCard(bout);

    expect(inserted(bout.db)).toEqual([
      expect.objectContaining({ reason: 'black_card_2', can_continue: true }),
    ]);
    expect(fighterStates(bout.db)).toEqual([]);
    expect(reviewOps(bout.db)).toEqual(['insert']);
  });

  it('sent again: still no disqualification, and the review is written', async () => {
    const bout = opened(RULESET_SECOND_OUT, ENDS_THE_BOUT, { cards: [blackCard(), SAVED_SECOND] });

    await sendCard(bout);

    expect(fighterStates(bout.db)).toEqual([]);
    expect(reviewOps(bout.db)).toEqual(['insert']);
  });

  it('by hand: the card forfeit ends the bout only', async () => {
    const bout = opened(RULESET_SECOND_OUT, ENDS_THE_BOUT);

    await recordForfeit(bout, 'black_card_2');

    expect(inserted(bout.db)).toEqual([
      expect.objectContaining({ reason: 'black_card_2', can_continue: true }),
    ]);
    expect(fighterStates(bout.db)).toEqual([]);
  });

  it('the other way: a Tournament’s 2nd card that disqualifies opens no review', async () => {
    const bout = opened(
      { first: 'match', second: 'match' },
      { secondBlackCard: 'tournament' },
      {
        cards: SECOND_CARD,
      },
    );

    await sendCard(bout);

    expect(cardsPutOut(bout)).toMatchObject({ secondCardOut: true });
    expect(reviewOps(bout.db)).toEqual([]);
  });

  it('reads the changes in the read of the pin', async () => {
    const bout = opened(RULESET_SECOND_OUT, ENDS_THE_BOUT, { cards: SECOND_CARD });

    await sendCard(bout);

    // The double ignores the projection: only the select proves the changes are read.
    expect(selectsFor(bout.db.from, 'tournaments')).toContain(
      'penalty_ruleset_id, event_id, forfeit_rules',
    );
  });
});

describe('a Tournament’s 1st black card change (ruling 65)', () => {
  it('a 1st card that reaches the Tournament disqualifies: her bouts follow the settle', async () => {
    const bout = opened({ first: 'match', second: 'match' }, { firstBlackCard: 'tournament' });

    await sendCard(bout);

    // Her later Pool bout is the reconcile's, once the settle has her out (B2).
    expect(inserted(bout.db)).toEqual([
      expect.objectContaining({ reason: 'black_card_1', can_continue: false, match_id: 'm1' }),
    ]);
    expect(cardsPutOut(bout)).toMatchObject({ firstCardOut: true });
    expect(fighterStates(bout.db)).toEqual([]);
  });

  it('a 1st card forfeit by hand that does nothing ends that bout only', async () => {
    const bout = opened({ first: 'tournament', second: 'tournament' }, { firstBlackCard: 'none' });

    await recordForfeit(bout, 'black_card_1');

    expect(inserted(bout.db)).toEqual([
      expect.objectContaining({ reason: 'black_card_1', can_continue: true }),
    ]);
    expect(fighterStates(bout.db)).toEqual([]);
  });
});

describe('a Tournament’s other changes', () => {
  it('its black card score is the card forfeit’s 0-X (ruling 69)', async () => {
    const bout = opened(RULESET_SECOND_OUT, { blackCardOpponentScore: 17 });

    await sendCard(bout);

    expect(inserted(bout.db)).toEqual([
      expect.objectContaining({ reason: 'black_card_1', forfeiting_score: 0, opponent_score: 17 }),
    ]);
  });

  it('a reason’s change is what a hand forfeit does', async () => {
    const bout = opened(RULESET_SECOND_OUT, { reasons: { injury: { fighter: 'disqualified' } } });

    await recordForfeit(bout, 'injury');

    expect(inserted(bout.db)[0]).toMatchObject({
      reason: 'injury',
      fighter_outcome: 'disqualified',
    });
  });
});

describe('stored changes that do not parse (a hand-edited archive)', () => {
  const BROKEN = { secondBlackCard: 'foo' };

  it('refuse a card with a server error, before it is written', async () => {
    const bout = opened(RULESET_SECOND_OUT, BROKEN, { cards: SECOND_CARD });

    await expect(sendCard(bout)).rejects.toBeInstanceOf(ForfeitRulesInvalidError);
    expect(writesTo(bout.db, 'match_penalties')).toEqual([]);
  });

  it('refuse a forfeit by hand with the 409 that names them', async () => {
    const bout = opened(RULESET_SECOND_OUT, BROKEN);

    await expect(recordForfeit(bout, 'injury')).rejects.toMatchObject({
      status: 409,
      response: { code: 'forfeit_rules_invalid' },
    });
    expect(writesTo(bout.db, 'match_forfeits')).toEqual([]);
  });
});
