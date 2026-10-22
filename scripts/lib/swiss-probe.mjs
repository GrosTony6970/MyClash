/**
 * Check 17 of the RLS probe (`scripts/db-rls-probe.mjs`), its first half: a Swiss round is written
 * in one locked step, and a withdraw takes the same lock (migration 0243, slice B-Swiss). The
 * second half, a Swiss Fighter's pairings following their status (0244), is
 * `swiss-status-probe.mjs`; the seed and the calls are `swiss-probe-kit.mjs`.
 *
 * Every answer is asserted strictly: a stub that answers NULL fails each case on its answer.
 *
 * NOT the lock: every case runs in one rolled-back transaction, so a second call never waits.
 * The lock is held by its text (0243's and 0244's DO blocks), read again here on every replay.
 */

import { PHASE, SEED_COPY } from './match-rules-probe-kit.mjs';
import {
  bout,
  caseFailures,
  commit,
  entrantOf,
  FIELD,
  FIGHTER,
  FOURTH,
  functionFailures,
  OPPONENT,
  released,
  roundCount,
  SWISS,
  THIRD,
  withdraw,
} from './swiss-probe-kit.mjs';

const LOCKED = [
  'public.swiss_withdraw(uuid, uuid, text)',
  'public.swiss_commit_round(uuid, integer, uuid[], uuid, jsonb, jsonb)',
];

/** Round 1 of the four: board 2 sent first, so the answer must order the ids itself. */
const ROUND_1 = [bout(THIRD, FOURTH, 2), bout(FIGHTER, OPPONENT, 1)];

/** The cases; each throws what is wrong. */
const CASES = [
  {
    what: 'a round and its bouts are written, the ids in board order',
    run: async (sp) => {
      const r = await commit(sp, 1, FIELD, ROUND_1);
      if (r?.status !== 'committed' || r.matchIds?.length !== 2) {
        throw new Error(`answered ${JSON.stringify(r)}`);
      }
      const rows = await sp`
        SELECT m.id, m.phase_id, m.swiss_round_id, m.red_registration_id, m.blue_registration_id,
               m.status, m.match_number_label, m.match_rules_id, sr.round_number, sr.status AS round_status
        FROM matches m JOIN swiss_rounds sr ON sr.id = m.swiss_round_id
        WHERE sr.id = ${r.roundId} ORDER BY m.match_number_label`;
      const [first, second] = rows;
      if (r.matchIds[0] !== first?.id || r.matchIds[1] !== second?.id) {
        throw new Error(`the ids are not in board order: ${JSON.stringify(r.matchIds)}`);
      }
      const set = (row, red, blue, label) =>
        row.phase_id === SWISS &&
        row.red_registration_id === red &&
        row.blue_registration_id === blue &&
        row.status === 'scheduled' &&
        row.match_number_label === label &&
        row.match_rules_id === SEED_COPY &&
        row.round_number === 1 &&
        row.round_status === 'pending';
      if (!set(first, FIGHTER, OPPONENT, 'SW-R1-M1') || !set(second, THIRD, FOURTH, 'SW-R1-M2')) {
        throw new Error(`the bouts are ${JSON.stringify(rows)}`);
      }
    },
  },
  {
    // Round 1's `ranked` breaks the point ties of every later round (`seedOrderOf`).
    what: 'a round holds its bye and the draw it was paired from',
    run: async (sp) => {
      await withdraw(sp, FOURTH, 'hand');
      const meta = { warnings: [], ranked: [FIGHTER, OPPONENT], manualAdjustments: [] };
      const field = [FIGHTER, OPPONENT, THIRD];
      const r = await commit(sp, 1, field, [bout(FIGHTER, OPPONENT, 1)], THIRD, meta);
      if (r?.status !== 'committed') throw new Error(`answered ${JSON.stringify(r)}`);
      const [round] = await sp`SELECT bye_registration_id, pairing_meta_json
                               FROM swiss_rounds WHERE id = ${r.roundId}`;
      if (round?.bye_registration_id !== THIRD) {
        throw new Error(`the bye is ${round?.bye_registration_id}`);
      }
      if (JSON.stringify(round.pairing_meta_json?.ranked) !== JSON.stringify(meta.ranked)) {
        throw new Error(`the draw is ${JSON.stringify(round.pairing_meta_json)}`);
      }
    },
  },
  {
    what: 'a round that stands already is answered, not written twice',
    run: async (sp) => {
      const first = await commit(sp, 1, FIELD, ROUND_1);
      const again = await commit(sp, 1, FIELD, ROUND_1);
      if (again?.status !== 'exists' || again.roundId !== first?.roundId) {
        throw new Error(`answered ${JSON.stringify(again)}`);
      }
      if ((await roundCount(sp)) !== 1) throw new Error('a second round was written');
    },
  },
  {
    what: 'a round that is not the next one is stale',
    run: async (sp) => {
      const r = await commit(sp, 2, FIELD, ROUND_1);
      if (r?.status !== 'stale') throw new Error(`answered ${JSON.stringify(r)}`);
      if ((await roundCount(sp)) !== 0) throw new Error('a round was written');
    },
  },
  {
    what: 'a field holding a Fighter withdrawn since the plan is stale (the race)',
    run: async (sp) => {
      const w = await withdraw(sp, FOURTH, 'hand');
      if (w?.withdrawnAtRound !== 1 || w.changed !== true) {
        throw new Error(`the withdraw answered ${JSON.stringify(w)}`);
      }
      const r = await commit(sp, 1, FIELD, ROUND_1);
      if (r?.status !== 'stale') throw new Error(`answered ${JSON.stringify(r)}`);
      if ((await roundCount(sp)) !== 0) throw new Error('a round was written');
    },
  },
  {
    what: 'a field missing an active Fighter is stale',
    run: async (sp) => {
      const r = await commit(
        sp,
        1,
        [FIGHTER, OPPONENT, THIRD],
        [bout(FIGHTER, OPPONENT, 1)],
        THIRD,
      );
      if (r?.status !== 'stale') throw new Error(`answered ${JSON.stringify(r)}`);
      if ((await roundCount(sp)) !== 0) throw new Error('a round was written');
    },
  },
  {
    what: 'a bout that fails leaves no round (the stranded round)',
    run: async (sp) => {
      const error = await released(sp, (inner) =>
        commit(inner, 1, FIELD, [bout(FIGHTER, OPPONENT, 1), bout(THIRD, FOURTH, 2, 'bogus')]),
      );
      if (error?.constraint_name !== 'match_status_check') {
        throw new Error(`the bad bout raised ${error ? error.message : 'nothing'}`);
      }
      if ((await roundCount(sp)) !== 0) throw new Error('the round stands without its bouts');
    },
  },
  {
    what: 'a withdraw counts the rounds written before it and keeps its kind',
    run: async (sp) => {
      await commit(sp, 1, FIELD, ROUND_1);
      const w = await withdraw(sp, FIGHTER, 'hand');
      if (w?.withdrawnAtRound !== 2 || w.changed !== true) {
        throw new Error(`answered ${JSON.stringify(w)}`);
      }
      const again = await withdraw(sp, FIGHTER, 'status');
      if (again?.withdrawnAtRound !== 2 || again.changed !== false) {
        throw new Error(`the second withdraw answered ${JSON.stringify(again)}`);
      }
      const row = await entrantOf(sp, FIGHTER);
      if (row.withdrawn_at_round !== 2 || row.withdrawn_by !== 'hand') {
        throw new Error(`the entrant is ${JSON.stringify(row)}`);
      }
      // One Fighter in one phase: the others stay paired.
      for (const other of [OPPONENT, THIRD, FOURTH]) {
        const rest = await entrantOf(sp, other);
        if (rest.withdrawn_at_round !== null || rest.withdrawn_by !== null) {
          throw new Error(`${other} was withdrawn too: ${JSON.stringify(rest)}`);
        }
      }
    },
  },
];

/** Each refused by its SQLSTATE or its CHECK's name. */
const REFUSALS = [
  {
    what: 'a withdrawal kind that is none',
    code: '22023',
    run: (sp) => withdraw(sp, FIGHTER, 'organiser'),
  },
  {
    what: 'a withdraw of a Registration not in the phase',
    code: 'P0002',
    run: (sp) => withdraw(sp, 'cccccccc-0000-4000-8000-00000000000c', 'hand'),
  },
  {
    what: 'a commit on a phase that is not Swiss',
    code: 'P0002',
    run: (sp) =>
      sp`SELECT public.swiss_commit_round(${PHASE}, 1, '{}'::uuid[], NULL, '{}'::jsonb,
                                          '[]'::jsonb)`,
  },
  {
    what: 'a withdrawal kind the column refuses',
    by: 'swiss_entrants_withdrawn_by_allowed',
    run: (sp) =>
      sp`UPDATE swiss_entrants SET withdrawn_at_round = 1, withdrawn_by = 'organiser'
         WHERE phase_id = ${SWISS} AND registration_id = ${FIGHTER}`,
  },
  {
    what: 'a withdrawal round with no kind',
    by: 'swiss_entrants_withdrawn_by_follows_round',
    run: (sp) =>
      sp`UPDATE swiss_entrants SET withdrawn_at_round = 1
         WHERE phase_id = ${SWISS} AND registration_id = ${FIGHTER}`,
  },
];

/** What is wrong, as sentences; none when all is right. */
export async function swissFailures(tx) {
  const pins = await functionFailures(tx, LOCKED, { locked: true });
  if (pins.some((failure) => failure.endsWith('does not exist'))) return pins;
  return [...pins, ...(await caseFailures(tx, CASES, REFUSALS))];
}
