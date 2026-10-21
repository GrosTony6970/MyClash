import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  CLUB_START_FORFEIT_RULES,
  FFAMHE_FORFEIT_RULES,
  type ForfeitRules,
} from '@myclash/types/forfeit-rules';
import { scopedTo, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import {
  bout,
  fighterStates,
  inserted,
  outcome,
  withInjury,
} from './match-forfeits.rules.fixtures';

/**
 * A forfeit is a cause of its Fighter's status, no longer a writer of it (slice B, migration 0240):
 * the record stores what it did to its Fighter at its time (`fighter_outcome`), and the door asks
 * the status settle AFTER its own writes. Every retry of the door settles too, so a first send cut
 * short after its record is repaired by the next. What the settle then answers is probe check 16's.
 */

const asked = (injury: ForfeitRules['reasons']['injury']) => withInjury(injury);
const ASKS = asked({ outcome: 'keep_current', opponentScore: 6, fighter: 'asks' });

/** A live forfeit of Red on another bout of the Pool, made earlier. */
const earlierForfeit = (over: Record<string, unknown> = {}) => ({
  id: 'ff-earlier',
  match_id: 'm9',
  tournament_id: 'tournament-1',
  forfeiting_registration_id: 'reg-red',
  reason: 'voluntary',
  parent_forfeit_id: null,
  can_continue: true,
  auto_created: false,
  voided_at: null,
  'matches.pool_id': 'pool-1',
  created_at: '2026-10-21T09:00:00.000Z',
  ...over,
});

/** The tables written before each settle, and whom it settled. */
const settles = (status: ReturnType<typeof bout>['status']) =>
  status.calls.map(({ input, writesBefore }) => ({
    fighter: `${input.registrationId}@${input.tournamentId}`,
    after: writesBefore.map((write) => `${write.table}:${write.op}`),
  }));

describe('a forfeit stores what it did to its Fighter, at its time', () => {
  it('a withdrawal: the Fighter cannot continue', async () => {
    const { db, forfeit } = bout(ASKS);
    await forfeit('injury', false);
    expect(outcome(db)).toBe('withdrawn');
  });

  it('nothing when the Fighter continues', async () => {
    const { db, forfeit } = bout(ASKS);
    await forfeit('injury', true);
    expect(outcome(db)).toBeNull();
  });

  it('a disqualification when its reason disqualifies', async () => {
    const { db, forfeit } = bout(FFAMHE_FORFEIT_RULES);
    await forfeit('conduct_violation');
    expect(outcome(db)).toBe('disqualified');
  });

  it('a disqualification when it comes before the Fighter’s 1st bout', async () => {
    const { db, forfeit } = bout({ ...CLUB_START_FORFEIT_RULES, disqualifyBeforeFirstBout: true });
    await forfeit('voluntary', true);
    expect(outcome(db)).toBe('disqualified');
  });

  it('nothing for the N-th forfeit: the settle counts (ruling 80), and the Pool still cascades', async () => {
    const { db, forfeit } = bout(FFAMHE_FORFEIT_RULES, [earlierForfeit()]);
    await forfeit('voluntary', true);
    const rows = inserted(db);
    expect(rows[0]).toMatchObject({ match_id: 'm1', fighter_outcome: null, can_continue: false });
    // Until the bouts follow the status (B2), the N-th forfeit forfeits the later Pool bout.
    expect(rows[1]).toMatchObject({ match_id: 'm2', auto_created: true });
    expect(rows[1]?.['fighter_outcome'] ?? null).toBeNull();
  });

  // A black card forfeit recorded by hand has no card for the settle to count: it is its own cause.
  it.each([
    ['black_card_2', 'disqualified'],
    ['black_card_1', null],
  ])(
    'a %s forfeit recorded by hand stores what its card rule does (rulings 58, 82)',
    async (reason, want) => {
      // The built-in's 1st card ends the bout, its 2nd reaches the Tournament.
      const { db, forfeit } = bout(FFAMHE_FORFEIT_RULES);
      await forfeit(reason, true);
      expect(outcome(db)).toBe(want);
    },
  );

  it('nothing for a black card forfeit its card sent: the card is the cause (ruling 56)', async () => {
    const { db, service } = bout(FFAMHE_FORFEIT_RULES);
    await service.createForfeit(
      'm1',
      { forfeitingRegistrationId: 'reg-red', reason: 'black_card_1', canContinue: true } as never,
      {},
      undefined,
      { rules: FFAMHE_FORFEIT_RULES, cardEffect: 'tournament' },
    );
    expect(outcome(db)).toBeNull();
  });

  it('nothing for a forfeit recorded under a live withdrawal (ruling 89)', async () => {
    const withdrawal = earlierForfeit({ reason: 'injury', can_continue: false });
    const { db, forfeit } = bout(ASKS, [withdrawal]);
    await forfeit('injury', false);
    expect(inserted(db)[0]).toMatchObject({
      parent_forfeit_id: 'ff-earlier',
      fighter_outcome: null,
    });
  });

  it('a disqualification under a live withdrawal when its reason disqualifies (ruling 112)', async () => {
    const withdrawal = earlierForfeit({ reason: 'injury', can_continue: false });
    const { db, forfeit } = bout(FFAMHE_FORFEIT_RULES, [withdrawal]);
    await forfeit('conduct_violation');
    expect(inserted(db)[0]).toMatchObject({
      parent_forfeit_id: 'ff-earlier',
      fighter_outcome: 'disqualified',
    });
  });

  it('nothing for an override: nobody forfeited', async () => {
    const { db, service } = bout(FFAMHE_FORFEIT_RULES, [], 'pool', { status: 'completed' });
    await service.createForfeit('m1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'admin_correction',
      explicitScores: { forfeitingScore: 1, opponentScore: 5 },
    } as never);
    expect(outcome(db)).toBeNull();
  });
});

describe('a forfeit settles its Fighter, after its own writes', () => {
  it('once its record is written and its bout closed, and writes no status itself', async () => {
    const { db, forfeit, status } = bout(ASKS);
    await forfeit('injury', false);
    expect(settles(status)).toEqual([expect.objectContaining({ fighter: 'reg-red@tournament-1' })]);
    expect(settles(status)[0]?.after).toEqual(
      expect.arrayContaining(['match_forfeits:insert', 'matches:update']),
    );
    expect(fighterStates(db)).toEqual([]);
  });

  it('a settle that fails is a server error, never the 400 of a refused forfeit', async () => {
    const { forfeit, status } = bout(ASKS);
    status.settle.mockRejectedValueOnce(new Error('the database is away'));
    const failure = await forfeit('injury', false).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(BadRequestException);
  });

  it('settles last: a settle that fails leaves the forfeit whole, for its retry to settle', async () => {
    const { db, forfeit, status } = bout(ASKS);
    status.settle.mockRejectedValueOnce(new Error('the database is away'));
    await forfeit('injury', false).catch(() => undefined);
    // The later Pool bout forfeited with it, and the result it produced stamped on it.
    expect(inserted(db).map((row) => row['match_id'])).toEqual(['m1', 'm2']);
    expect(status.settle).toHaveBeenCalledTimes(1);
    // The forfeit's OWN result stamp, not the one of the bout forfeited with it.
    expect(
      writesTo(db, 'match_forfeits').some(
        (write) =>
          scopedTo(write, 'id') === 'ff-m1' &&
          Object.hasOwn(write.row as object, 'resulting_match_state'),
      ),
    ).toBe(true);
  });
});

describe('every retry of the forfeit door settles', () => {
  const ownRecord = earlierForfeit({ id: 'ff-m1', match_id: 'm1' });

  it('a forfeit sent again on its bout, closed by its first send, settles, then is refused', async () => {
    const { forfeit, status } = bout(ASKS, [ownRecord], 'pool', { status: 'completed' });
    await expect(forfeit('injury', false)).rejects.toThrow('Match is already closed');
    expect(settles(status)).toEqual([{ fighter: 'reg-red@tournament-1', after: [] }]);
  });

  it('the other Fighter’s record on a closed bout settles nobody', async () => {
    const theirs = { ...ownRecord, forfeiting_registration_id: 'reg-blue' };
    const { forfeit, status } = bout(ASKS, [theirs], 'pool', { status: 'completed' });
    await expect(forfeit('injury', false)).rejects.toThrow('Match is already closed');
    expect(status.calls).toEqual([]);
  });

  it('a bout closed with no record settles nobody', async () => {
    const { forfeit, status } = bout(ASKS, [], 'pool', { status: 'completed' });
    await expect(forfeit('injury', false)).rejects.toThrow('Match is already closed');
    expect(status.calls).toEqual([]);
  });

  it('a forfeit sent again on a bout back in play answers its record, and settles', async () => {
    const { db, forfeit, status } = bout(ASKS, [ownRecord]);
    await expect(forfeit('injury', false)).resolves.toMatchObject({ id: 'ff-m1' });
    expect(inserted(db)).toEqual([]);
    expect(settles(status)).toEqual([{ fighter: 'reg-red@tournament-1', after: [] }]);
  });
});

describe('taking a forfeit back settles its Fighter: no status it found is written back', () => {
  const standing = earlierForfeit({
    id: 'ff-m1',
    match_id: 'm1',
    reason: 'injury',
    can_continue: false,
    fighter_outcome: 'withdrawn',
    downstream_match_ids: [],
    previous_match_state: { status: 'running', red_score: 2, blue_score: 3 },
    resulting_match_state: {},
    previous_registration_state: { id: 'reg-red', status: 'checked_in' },
  });

  it('settles once the record is stamped, and writes no status', async () => {
    const { db, service, status } = bout(ASKS, [standing], 'pool', { status: 'completed' });
    await service.voidForfeit('ff-m1');
    expect(settles(status)).toEqual([expect.objectContaining({ fighter: 'reg-red@tournament-1' })]);
    const stamp = writesTo(db, 'match_forfeits').find((write) =>
      Object.hasOwn(write.row as object, 'voided_at'),
    );
    expect(stamp).toBeDefined();
    expect(settles(status)[0]?.after).toContain('match_forfeits:update');
    expect(fighterStates(db)).toEqual([]);
  });

  // Ruling 112: Ana withdraws injured in bout 1; bout 2 was running, so it was not forfeited; in it
  // she commits a conduct violation, recorded under the withdrawal. The injury is voided: she stays
  // disqualified, so that forfeit stays and its bout keeps its result.
  it('voiding the withdrawal leaves a disqualifying forfeit recorded under it', async () => {
    const child = (id: string, matchId: string, over: Record<string, unknown>) =>
      earlierForfeit({
        id,
        match_id: matchId,
        parent_forfeit_id: 'ff-m1',
        // Forfeited from paused: put back, it takes no ruleset of now (nothing more to read).
        previous_match_state: { status: 'paused' },
        resulting_match_state: {},
        ...over,
      });
    const { db, service } = bout(ASKS, [
      standing,
      child('ff-auto', 'm2', { auto_created: true, can_continue: false, fighter_outcome: null }),
      child('ff-conduct', 'm3', { reason: 'conduct_violation', fighter_outcome: 'disqualified' }),
    ]);

    const result = await service.voidForfeit('ff-m1');

    const stamped = writesTo(db, 'match_forfeits')
      .filter((write) => Object.hasOwn(write.row as object, 'voided_at'))
      .map((write) => scopedTo(write, 'id'));
    expect(stamped.sort()).toEqual(['ff-auto', 'ff-m1']);
    expect(writesTo(db, 'matches').map((write) => scopedTo(write, 'id'))).not.toContain('m3');
    expect(result).toMatchObject({ cascaded_forfeit_count: 1 });
    // The double answers whatever the select names: the column must be asked for.
    expect(selectsFor(db.from, 'match_forfeits')).toContain(
      'id, match_id, previous_match_state, resulting_match_state, fighter_outcome',
    );
  });

  it('a take-back sent again, its record already voided, settles, then is refused', async () => {
    const voided = { ...standing, voided_at: '2026-10-21T10:00:00.000Z' };
    const { service, status } = bout(ASKS, [voided], 'pool', { status: 'running' });
    await expect(service.voidForfeit('ff-m1')).rejects.toThrow('Forfeit is already voided');
    expect(settles(status)).toEqual([{ fighter: 'reg-red@tournament-1', after: [] }]);
  });
});
