/**
 * Check 17 of the RLS probe (`scripts/db-rls-probe.mjs`), its second half: a Swiss Fighter's
 * pairings follow their status, and the organiser can put a withdrawn Fighter back (migration
 * 0244, slice B-Swiss; rulings 77, 81, 108, 121-126). The first half is `swiss-probe.mjs`.
 *
 * Each case seeds a Swiss phase in a savepoint rolled back (`swiss-probe-kit.mjs`), calls the
 * functions AS THE OWNER and reads the rows back; every answer is asserted strictly.
 */

import { TOURNAMENT } from './match-rules-probe-kit.mjs';
import {
  bout,
  caseFailures,
  commit,
  deleteLast,
  entrantOf,
  FIELD,
  FIGHTER,
  finalise,
  FOURTH,
  functionFailures,
  OPPONENT,
  over,
  putBack,
  roundCount,
  seedSwiss,
  SWISS,
  THIRD,
  withdraw,
} from './swiss-probe-kit.mjs';

const OVER = 'public.swiss_phase_over(uuid)';
/** No entrant of the phase, nor any Registration. */
const NOT_AN_ENTRANT = 'c0f00000-0000-4000-8000-0000000017ff';
const LOCKED = [
  'public.swiss_put_back(uuid, uuid, text)',
  'public.swiss_delete_last_round(uuid, integer, text[])',
];
const WRITERS_OF_OVER = ['public.swiss_withdraw(uuid, uuid, text)', ...LOCKED.slice(0, 1)];
const LOCK_ANY = String.raw`\yfor\s+(no\s+key\s+)?update\y`;
const ASKS_OVER = String.raw`\yswiss_phase_over\s*\(`;

const same = (got, want) => JSON.stringify(got) === JSON.stringify(want);
const expect = (got, want, what) => {
  if (!same(got, want)) throw new Error(`${what} is ${JSON.stringify(got)}`);
};

/** Round 1 without the Fighter: Opponent v Third, Fourth's bye. */
const withoutFighter = (sp, round = 1) =>
  commit(
    sp,
    round,
    [OPPONENT, THIRD, FOURTH],
    [bout(OPPONENT, THIRD, 1, 'scheduled', round)],
    FOURTH,
  );

/** The Fighter out of the Tournament, as a settle leaves them. */
const fighterOut = (sp) =>
  sp`UPDATE registrations SET status = 'withdrawn', entry_status = 'withdrawn', out_since = now()
     WHERE id = ${FIGHTER} AND tournament_id = ${TOURNAMENT}`;

const completeRound = (sp, roundId) =>
  sp`UPDATE matches SET status = 'completed' WHERE swiss_round_id = ${roundId}`;

/** A one-round phase whose round is paired; its id. */
async function oneRoundPaired(sp) {
  const r = await commit(sp, 1, FIELD, [bout(FIGHTER, OPPONENT, 1), bout(THIRD, FOURTH, 2)]);
  return r.roundId;
}

const CASES = [
  {
    what: 'a phase with rounds to pair is not over, finalised or resumed',
    run: async (sp) => {
      expect(await over(sp), false, 'over, as generated');
      await finalise(sp);
      expect(await over(sp), true, 'over, finalised');
      await finalise(sp, false);
      expect(await over(sp), false, 'over, resumed');
    },
  },
  {
    what: 'a phase whose last configured round is fought is over, not while it is played',
    seed: (sp) => seedSwiss(sp, 1),
    run: async (sp) => {
      const round = await oneRoundPaired(sp);
      expect(await over(sp), false, 'over, round paired');
      await sp`UPDATE matches SET status = 'completed'
               WHERE swiss_round_id = ${round} AND red_registration_id = ${FIGHTER}`;
      expect(await over(sp), false, 'over, one bout of two fought');
      await completeRound(sp, round);
      expect(await over(sp), true, 'over, round fought');
    },
  },
  {
    what: 'a round count that is no number reads "not over", the round fought or not',
    seed: (sp) => seedSwiss(sp, 1),
    run: async (sp) => {
      await completeRound(sp, await oneRoundPaired(sp));
      expect(await over(sp), true, 'over, a count of 1');
      await sp`UPDATE phases SET config_json = config_json || ${sp.json({ roundCount: '1' })}
               WHERE id = ${SWISS}`;
      expect(await over(sp), false, 'over, a count of "1"');
    },
  },
  {
    what: 'a last round holding only a bye is not over',
    seed: (sp) => seedSwiss(sp, 1),
    run: async (sp) => {
      for (const other of [OPPONENT, THIRD, FOURTH]) await withdraw(sp, other, 'hand');
      const r = await commit(sp, 1, [FIGHTER], [], FIGHTER);
      expect(r?.status, 'committed', 'the commit');
      expect(await over(sp), false, 'over');
    },
  },
  {
    what: 'a status withdraw leaves a phase that is over alone (125)',
    run: async (sp) => {
      await finalise(sp);
      expect(
        await withdraw(sp, FIGHTER, 'status'),
        { changed: false, withdrawnAtRound: null },
        'the answer',
      );
      expect((await entrantOf(sp, FIGHTER)).withdrawn_at_round, null, 'the entrant');
    },
  },
  {
    what: 'a status withdraw once the phase is resumed takes the Fighter out (127)',
    run: async (sp) => {
      await finalise(sp);
      await withdraw(sp, FIGHTER, 'status');
      await finalise(sp, false);
      expect(
        await withdraw(sp, FIGHTER, 'status'),
        { changed: true, withdrawnAtRound: 1 },
        'the answer',
      );
    },
  },
  {
    what: 'a put-back of an entrant who is in answers "in" and writes nothing',
    run: async (sp) => {
      expect(await putBack(sp, FIGHTER, 'hand'), { status: 'in', missedRounds: [] }, 'the answer');
      expect(
        await entrantOf(sp, FIGHTER),
        { withdrawn_at_round: null, withdrawn_by: null, missed_rounds: [] },
        'the entrant',
      );
    },
  },
  {
    what: 'the status puts a Fighter back before a round is paired without them (81)',
    run: async (sp) => {
      await withdraw(sp, FIGHTER, 'status');
      expect(
        await putBack(sp, FIGHTER, 'status'),
        { status: 'put_back', missedRounds: [] },
        'the answer',
      );
      expect(
        await entrantOf(sp, FIGHTER),
        { withdrawn_at_round: null, withdrawn_by: null, missed_rounds: [] },
        'the entrant',
      );
    },
  },
  {
    what: 'the status keeps out a Fighter a round was paired without (81)',
    run: async (sp) => {
      await withdraw(sp, FIGHTER, 'status');
      await withoutFighter(sp);
      expect(
        await putBack(sp, FIGHTER, 'status'),
        { status: 'kept', missedRounds: [] },
        'the answer',
      );
      expect((await entrantOf(sp, FIGHTER)).withdrawn_by, 'status', 'the kind');
    },
  },
  {
    what: 'the status never undoes a withdrawal by hand',
    run: async (sp) => {
      await withdraw(sp, FIGHTER, 'hand');
      expect((await putBack(sp, FIGHTER, 'status'))?.status, 'kept', 'the answer');
      expect((await entrantOf(sp, FIGHTER)).withdrawn_by, 'hand', 'the kind');
    },
  },
  {
    what: 'the status leaves a phase that is over alone (126)',
    run: async (sp) => {
      await withdraw(sp, FIGHTER, 'status');
      await finalise(sp);
      expect((await putBack(sp, FIGHTER, 'status'))?.status, 'kept', 'the answer');
    },
  },
  {
    what: 'the organiser puts a Fighter back, the rounds they missed recorded (108, 121, 122)',
    run: async (sp) => {
      await withdraw(sp, FIGHTER, 'status');
      await withoutFighter(sp);
      expect(
        await putBack(sp, FIGHTER, 'hand'),
        { status: 'put_back', missedRounds: [1] },
        'the answer',
      );
      expect(
        await entrantOf(sp, FIGHTER),
        { withdrawn_at_round: null, withdrawn_by: null, missed_rounds: [1] },
        'the entrant',
      );
      // Paired again from the next round.
      const r = await commit(sp, 2, FIELD, [
        bout(FIGHTER, OPPONENT, 1, 'scheduled', 2),
        bout(THIRD, FOURTH, 2, 'scheduled', 2),
      ]);
      expect(r?.status, 'committed', 'round 2');
    },
  },
  {
    what: 'the status keeps a Fighter out of the Tournament out',
    run: async (sp) => {
      await withdraw(sp, FIGHTER, 'status');
      await fighterOut(sp);
      expect((await putBack(sp, FIGHTER, 'status'))?.status, 'kept', 'the answer');
    },
  },
  {
    what: 'deleting the last round deletes its bouts, forgets its number, and keeps the earlier one',
    run: async (sp) => {
      const first = await commit(sp, 1, FIELD, [
        bout(FIGHTER, OPPONENT, 1),
        bout(THIRD, FOURTH, 2),
      ]);
      await completeRound(sp, first.roundId);
      await withdraw(sp, FIGHTER, 'hand');
      await withoutFighter(sp, 2);
      await putBack(sp, FIGHTER, 'hand');
      expect((await entrantOf(sp, FIGHTER)).missed_rounds, [2], 'missed before the delete');
      expect(await deleteLast(sp, 2), { matches: 1 }, 'the answer');
      expect((await entrantOf(sp, FIGHTER)).missed_rounds, [], 'missed after the delete');
      expect(await roundCount(sp), 1, 'the rounds left');
      const [kept] =
        await sp`SELECT count(*)::int AS n FROM matches WHERE swiss_round_id = ${first.roundId}`;
      expect(kept.n, 2, "round 1's bouts");
    },
  },
  {
    what: 'a last round whose only activity was voided can be deleted',
    run: async (sp) => {
      const round = await oneRoundPaired(sp);
      await sp`UPDATE matches SET status = 'voided' WHERE swiss_round_id = ${round}`;
      expect(await deleteLast(sp, 1), { matches: 2 }, 'the answer');
      expect(await roundCount(sp), 0, 'the rounds left');
    },
  },
];

/** A round 1 paired, one bout in `status`. */
const pairedWith = (status) => async (sp) => {
  const round = await oneRoundPaired(sp);
  await sp`UPDATE matches SET status = ${status}
           WHERE swiss_round_id = ${round} AND red_registration_id = ${FIGHTER}`;
};

const REFUSALS = [
  {
    what: 'a hand put-back of a Fighter out of the Tournament (122)',
    code: 'P0001',
    prefix: 'fighter_out',
    setup: async (sp) => {
      await withdraw(sp, FIGHTER, 'hand');
      await fighterOut(sp);
    },
    run: (sp) => putBack(sp, FIGHTER, 'hand'),
  },
  {
    what: 'a put-back kind that is none',
    code: '22023',
    run: (sp) => putBack(sp, FIGHTER, 'organiser'),
  },
  {
    what: 'a put-back of a Fighter who is not an entrant',
    code: 'P0002',
    prefix: 'registration',
    run: (sp) => putBack(sp, NOT_AN_ENTRANT, 'hand'),
  },
  {
    what: 'a delete on a phase with no round',
    code: 'P0002',
    prefix: `swiss phase ${SWISS} has no rounds`,
    run: (sp) => deleteLast(sp, 1),
  },
  {
    what: 'a delete of a round that is not the last',
    code: 'P0001',
    prefix: 'not_last_round: 1',
    setup: oneRoundPaired,
    run: (sp) => deleteLast(sp, 2),
  },
  {
    what: 'a delete of no round number',
    code: 'P0001',
    prefix: 'not_last_round: 1',
    setup: oneRoundPaired,
    run: (sp) => deleteLast(sp, null),
  },
  {
    what: 'a delete of a round under way',
    code: 'P0001',
    prefix: 'round_under_way',
    setup: pairedWith('running'),
    run: (sp) => deleteLast(sp, 1),
  },
  {
    what: 'a delete of a round with a voided bout beside a fought one',
    code: 'P0001',
    prefix: 'round_under_way',
    setup: async (sp) => {
      const round = await oneRoundPaired(sp);
      await sp`UPDATE matches SET status = 'voided' WHERE swiss_round_id = ${round} AND red_registration_id = ${FIGHTER}`;
      await sp`UPDATE matches SET status = 'completed' WHERE swiss_round_id = ${round} AND red_registration_id = ${THIRD}`;
    },
    run: (sp) => deleteLast(sp, 1),
  },
  {
    what: 'a delete of a round holding a live forfeit',
    code: 'P0001',
    prefix: 'round_has_records',
    setup: async (sp) => {
      const round = await oneRoundPaired(sp);
      await sp`INSERT INTO match_forfeits (match_id, tournament_id, forfeiting_registration_id,
                                           winner_registration_id, reason, score_policy)
               SELECT id, ${TOURNAMENT}, ${FIGHTER}, ${OPPONENT}, 'injury', 'fixed_loss'
               FROM matches WHERE swiss_round_id = ${round} AND red_registration_id = ${FIGHTER}`;
    },
    run: (sp) => deleteLast(sp, 1),
  },
  {
    what: 'a delete of a round holding a live black card',
    code: 'P0001',
    prefix: 'round_has_records',
    setup: async (sp) => {
      const round = await oneRoundPaired(sp);
      await sp`INSERT INTO match_penalties (client_uuid, match_id, tournament_id, registration_id,
                                            sequence, card, occurred_at)
               SELECT gen_random_uuid(), id, ${TOURNAMENT}, ${FIGHTER}, 1, 'black', now()
               FROM matches WHERE swiss_round_id = ${round} AND red_registration_id = ${FIGHTER}`;
    },
    run: (sp) => deleteLast(sp, 1),
  },
  {
    what: 'a missed round that is no round',
    by: 'swiss_entrants_missed_rounds_valid',
    run: (sp) =>
      sp`UPDATE swiss_entrants SET missed_rounds = '{0}' WHERE phase_id = ${SWISS} AND registration_id = ${FIGHTER}`,
  },
  {
    what: 'a missed round that is null',
    by: 'swiss_entrants_missed_rounds_valid',
    run: (sp) =>
      sp`UPDATE swiss_entrants SET missed_rounds = '{NULL}' WHERE phase_id = ${SWISS} AND registration_id = ${FIGHTER}`,
  },
  {
    what: 'missed rounds of two dimensions',
    by: 'swiss_entrants_missed_rounds_valid',
    run: (sp) =>
      sp`UPDATE swiss_entrants SET missed_rounds = '{{1}}' WHERE phase_id = ${SWISS} AND registration_id = ${FIGHTER}`,
  },
];

/** "Over" takes no lock, and both writers ask it: one owner of the rule. */
async function overFailures(tx) {
  const failures = await functionFailures(tx, [OVER], { locked: false });
  if (failures.length > 0) return failures;
  const [own] =
    await tx`SELECT prosrc ~* ${LOCK_ANY} AS locks FROM pg_proc WHERE oid = ${OVER}::regprocedure`;
  if (own.locks) failures.push('check 17: swiss_phase_over takes a lock');
  for (const fn of WRITERS_OF_OVER) {
    const [row] =
      await tx`SELECT prosrc ~* ${ASKS_OVER} AS asks FROM pg_proc WHERE oid = ${fn}::regprocedure`;
    if (!row.asks) failures.push(`check 17: ${fn} does not ask swiss_phase_over`);
  }
  return failures;
}

/** What is wrong, as sentences; none when all is right. */
export async function swissStatusFailures(tx) {
  const pins = [
    ...(await functionFailures(tx, LOCKED, { locked: true })),
    ...(await overFailures(tx)),
  ];
  if (pins.some((failure) => failure.endsWith('does not exist'))) return pins;
  return [...pins, ...(await caseFailures(tx, CASES, REFUSALS))];
}
