import { describe, expect, it } from 'vitest';
import { filtersFor, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { cardsPutOut } from '../matches/fighter-status.fixtures';
import {
  CARD_RULES,
  blackCard,
  otherForfeit,
  setup,
  type CardPath,
  type Seed,
} from './penalties.void-black-card.fixtures';

/**
 * What a black card does follows the Tournament's penalty ruleset, its 1st and its 2nd card setting
 * (rulings 54, 56, 58, 82 and 86, 2026-10-20). Before, a hidden table of the scoring rules won: a
 * 2nd black card disqualified on every Tournament, whatever its penalty ruleset said, and a black
 * card counted toward "disqualify after N forfeits".
 *
 * Each story runs a real `PenaltiesService` over a real `MatchForfeitsService`. The double applies
 * no write, so a card "of before" is a seeded row: the card being sent is counted only as a seeded
 * card too (`blackCard()`), never through its own insert.
 */

const HOUSE_CARDS: CardPath = { first: 'match', second: 'match' };
const SECOND_CARD = [blackCard(), blackCard({ id: 'card-black-2' })];

function cardPath(path: CardPath, seed: Seed = {}) {
  return setup({ forfeit: null, cardPath: path, ...seed });
}

type Opened = ReturnType<typeof cardPath>;

/** The referee's black card to Blue, from the tablet. */
const sendCard = ({ service }: Opened, clientUuid = 'card-uuid') =>
  service.createPenalty(
    'm1',
    {
      clientUuid,
      sequence: 1,
      registrationId: 'reg-blue',
      directCard: 'black',
      reason: 'dangerous action',
      occurredAt: '2026-10-20T10:00:00.000Z',
    } as never,
    { staffAccountId: 'staff-1' },
  );

/** A forfeit of Blue an official records by hand. */
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
const reviewWrites = (db: Opened['db']) => writesTo(db, 'tournament_penalty_reviews');

/** An earlier forfeit of Blue, on another bout. */
const earlier = (over: Record<string, unknown>) =>
  otherForfeit({ auto_created: false, can_continue: true, ...over });

describe('a black card does what the Tournament’s penalty ruleset says', () => {
  it('a 2nd black card under rules that end only the bout does not disqualify', async () => {
    const opened = cardPath(HOUSE_CARDS, { cards: SECOND_CARD });

    await sendCard(opened);

    expect(inserted(opened.db)).toEqual([
      expect.objectContaining({ reason: 'black_card_2', can_continue: true, match_id: 'm1' }),
    ]);
    expect(fighterStates(opened.db)).toEqual([]);
  });

  it('a 1st black card that reaches the Tournament disqualifies, and forfeits the later Pool bout', async () => {
    const opened = cardPath({ first: 'tournament', second: 'tournament' });

    await sendCard(opened);

    expect(inserted(opened.db)).toEqual([
      expect.objectContaining({ reason: 'black_card_1', can_continue: false, match_id: 'm1' }),
      expect.objectContaining({ reason: 'black_card_1', auto_created: true, match_id: 'm2' }),
    ]);
    expect(cardsPutOut(opened)).toMatchObject({ firstCardOut: true });
    expect(fighterStates(opened.db)).toEqual([]);
  });

  it('a black card that does nothing writes no forfeit', async () => {
    const opened = cardPath({ first: 'none', second: 'none' });

    await sendCard(opened);

    expect(inserted(opened.db)).toEqual([]);
    expect(fighterStates(opened.db)).toEqual([]);
  });

  it('reads the card rules the Tournament pins, by the columns that decide a card', async () => {
    const opened = cardPath(HOUSE_CARDS);

    await sendCard(opened);

    // A double ignores the projection: the columns are read only if the read asks for them. Two
    // reads ask for them: the price, by the bout's copy ('ruleset-1'), and the reach, by the
    // Tournament's pin.
    const columns =
      'id, yellow_card_points, red_card_points, black_card_points, first_black_card_forfeit, second_black_card_forfeit, forfeit_rules';
    const reads = selectsFor(opened.db.from, 'penalty_rulesets');
    expect(reads.filter((read) => read === columns)).toHaveLength(2);
    expect(filtersFor(opened.db.from, 'penalty_rulesets', 'eq')).toEqual([
      ['id', 'ruleset-1'],
      ['id', CARD_RULES],
    ]);
  });

  it('a Tournament whose card rules no row holds is an error, and no card is written', async () => {
    const opened = cardPath({ ...HOUSE_CARDS, pin: 'cards-gone' });

    await expect(sendCard(opened)).rejects.toThrow('Tournament tournament-1 has no card rules');
    expect(writesTo(opened.db, 'match_penalties')).toEqual([]);
  });

  it('forfeit rules that do not parse are a server error, before the card is written', async () => {
    // The tablet sends a card again on a server error: it is not refused for good.
    const opened = cardPath({ ...HOUSE_CARDS, forfeitRules: { disqualifyAfter: 0 } });

    await expect(sendCard(opened)).rejects.toThrow('The forfeit rules of penalty ruleset');
    expect(writesTo(opened.db, 'match_penalties')).toEqual([]);
  });
});

describe('a black card is not a forfeit the Fighter chose (ruling 56)', () => {
  const twoForfeits = { disqualifyAfter: 2 };

  it('an injury after a black card forfeit is not the 2nd of "disqualify after 2"', async () => {
    const opened = cardPath(
      { ...HOUSE_CARDS, forfeitRules: twoForfeits },
      { otherForfeits: [earlier({ reason: 'black_card_1' })] },
    );

    await recordForfeit(opened, 'injury');

    expect(inserted(opened.db)).toEqual([
      expect.objectContaining({ reason: 'injury', can_continue: true }),
    ]);
    expect(fighterStates(opened.db)).toEqual([]);
  });

  it('a black card after an injury is not the 2nd of "disqualify after 2"', async () => {
    const opened = cardPath(
      { ...HOUSE_CARDS, forfeitRules: twoForfeits },
      { otherForfeits: [earlier({ reason: 'injury' })] },
    );

    await sendCard(opened);

    expect(inserted(opened.db)).toEqual([
      expect.objectContaining({ reason: 'black_card_1', can_continue: true }),
    ]);
    expect(fighterStates(opened.db)).toEqual([]);
  });

  const beforeFirstBout = { disqualifyBeforeFirstBout: true };

  it('a black card in the 1st bout is not "a forfeit before the 1st bout"', async () => {
    const opened = cardPath({ ...HOUSE_CARDS, forfeitRules: beforeFirstBout });

    await sendCard(opened);

    expect(inserted(opened.db)).toEqual([
      expect.objectContaining({ reason: 'black_card_1', can_continue: true }),
    ]);
    expect(fighterStates(opened.db)).toEqual([]);
  });

  it('a black card forfeit recorded by hand before the 1st bout disqualifies nobody', async () => {
    const opened = cardPath({ ...HOUSE_CARDS, forfeitRules: beforeFirstBout });

    await recordForfeit(opened, 'black_card_1');

    expect(inserted(opened.db)).toEqual([
      expect.objectContaining({ reason: 'black_card_1', can_continue: true }),
    ]);
    expect(fighterStates(opened.db)).toEqual([]);
  });

  it.each([
    ['forfeited with it', true],
    ['recorded again by hand since', false],
  ])(
    'a bout under a withdrawal, %s, is not counted toward "disqualify after 3"',
    async (_how, autoCreated) => {
      // HEAD counted the withdrawal, the bout under it and the new forfeit: 3, out.
      const root = earlier({ reason: 'injury', can_continue: false });
      const child = earlier({
        id: 'forfeit-3',
        match_id: 'm8',
        reason: 'injury',
        auto_created: autoCreated,
        parent_forfeit_id: 'forfeit-2',
      });
      const opened = cardPath(
        { ...HOUSE_CARDS, forfeitRules: { disqualifyAfter: 3 } },
        { otherForfeits: [root, child] },
      );

      await recordForfeit(opened, 'voluntary');

      expect(inserted(opened.db)).toEqual([
        expect.objectContaining({ reason: 'voluntary', can_continue: true }),
      ]);
      expect(fighterStates(opened.db)).toEqual([]);
    },
  );

  it('a forfeit recorded again under a live withdrawal is no 2nd of "disqualify after 2"', async () => {
    // Ruling 89. The Fighter withdrew in her Pool; the organiser voided one bout the withdrawal
    // forfeited and records it again by hand. It hangs under the withdrawal, and adds nothing.
    const root = earlier({ reason: 'injury', can_continue: false, 'matches.pool_id': 'pool-1' });
    const opened = cardPath(
      { ...HOUSE_CARDS, forfeitRules: { disqualifyAfter: 2 } },
      { otherForfeits: [root] },
    );

    await recordForfeit(opened, 'voluntary');

    expect(inserted(opened.db)).toEqual([
      expect.objectContaining({ reason: 'voluntary', parent_forfeit_id: 'forfeit-2' }),
    ]);
    expect(fighterStates(opened.db)).toEqual([]);
  });

  /** A live withdrawal of the Fighter in this bout's Pool. */
  const liveWithdrawal = earlier({
    reason: 'injury',
    can_continue: false,
    'matches.pool_id': 'pool-1',
  });

  it('a forfeit recorded again under a live withdrawal is no "forfeit before the 1st bout"', async () => {
    const opened = cardPath(
      { ...HOUSE_CARDS, forfeitRules: beforeFirstBout },
      { otherForfeits: [liveWithdrawal] },
    );

    await recordForfeit(opened, 'voluntary');

    expect(fighterStates(opened.db)).toEqual([]);
  });

  it('a black card that reaches the Tournament still disqualifies under a live withdrawal', async () => {
    const opened = cardPath(
      { first: 'tournament', second: 'tournament' },
      { otherForfeits: [liveWithdrawal] },
    );

    await recordForfeit(opened, 'black_card_1');

    // Recorded by hand, it has no card: it is its own cause, stored with it.
    expect(inserted(opened.db)[0]).toMatchObject({
      parent_forfeit_id: 'forfeit-2',
      fighter_outcome: 'disqualified',
    });
  });
});

describe('a black card forfeit recorded by hand follows its card rule (rulings 58, 82)', () => {
  it('a 2nd black card under rules that end only the bout does not disqualify', async () => {
    const opened = cardPath(HOUSE_CARDS);

    await recordForfeit(opened, 'black_card_2');

    expect(inserted(opened.db)).toEqual([
      expect.objectContaining({ reason: 'black_card_2', can_continue: true }),
    ]);
    expect(fighterStates(opened.db)).toEqual([]);
  });

  it('a 2nd black card whose rule does nothing ends that bout only', async () => {
    const opened = cardPath({ first: 'match', second: 'none' });

    await recordForfeit(opened, 'black_card_2');

    expect(inserted(opened.db)).toEqual([
      expect.objectContaining({ reason: 'black_card_2', can_continue: true, match_id: 'm1' }),
    ]);
    expect(writesTo(opened.db, 'matches')[0]?.row).toMatchObject({ status: 'completed' });
    expect(fighterStates(opened.db)).toEqual([]);
  });

  it('a 1st black card whose rule reaches the Tournament disqualifies', async () => {
    const opened = cardPath({ first: 'tournament', second: 'match' });

    await recordForfeit(opened, 'black_card_1');

    expect(inserted(opened.db)[0]).toMatchObject({
      reason: 'black_card_1',
      can_continue: false,
      fighter_outcome: 'disqualified',
    });
    expect(fighterStates(opened.db)).toEqual([]);
  });
});

describe('the "second black card" review asks only when the 2nd card does not disqualify (ruling 86)', () => {
  /** The 2nd black card the server already holds, as the tablet sends it again. */
  const saved = blackCard({
    id: 'card-black-2',
    client_uuid: 'card-uuid',
    causes_match_forfeit: true,
  });

  it('a 2nd black card that disqualifies opens no review', async () => {
    const opened = cardPath({ first: 'match', second: 'tournament' }, { cards: SECOND_CARD });

    await sendCard(opened);

    expect(cardsPutOut(opened)).toMatchObject({ secondCardOut: true });
    expect(reviewWrites(opened.db)).toEqual([]);
  });

  it('the same card sent again opens no review either', async () => {
    const opened = cardPath(
      { first: 'match', second: 'tournament' },
      { cards: [blackCard(), saved] },
    );

    await sendCard(opened);

    expect(writesTo(opened.db, 'match_penalties')).toEqual([]);
    expect(reviewWrites(opened.db)).toEqual([]);
  });

  it('a 2nd black card that ends only the bout opens the review', async () => {
    const opened = cardPath(HOUSE_CARDS, { cards: SECOND_CARD });

    await sendCard(opened);

    expect(reviewWrites(opened.db).map((write) => write.op)).toEqual(['insert']);
  });

  it('that card sent again still writes the review its first send left unwritten', async () => {
    const opened = cardPath(HOUSE_CARDS, { cards: [blackCard(), saved] });

    await sendCard(opened);

    expect(reviewWrites(opened.db).map((write) => write.op)).toEqual(['insert']);
  });
});
