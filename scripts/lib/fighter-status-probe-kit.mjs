/**
 * The rows and the calls check 16 of the RLS probe writes and reads (`fighter-status-probe.mjs`):
 * the seed's Registration of the published Tournament as the Fighter, its forfeits on bouts of
 * their own, its black cards on the seed's bout, a review, and `settle_fighter_status`.
 */

import { BOUT, PHASE, SEED_COPY, TOURNAMENT } from './match-rules-probe-kit.mjs';

export const FIGHTER = 'cccccccc-0000-4000-8000-00000000000a';
const OPPONENT = 'c0f00000-0000-4000-8000-00000000000a';
export const FN = 'public.settle_fighter_status(uuid, jsonb, timestamptz, text, text, boolean)';
export const NOW = '2026-10-21T10:00:00.000Z';
export const LATER = '2026-10-21T11:00:00.000Z';
export const RULES = {
  disqualifyAfter: null,
  firstCardOut: false,
  secondCardOut: true,
  countedReasons: ['injury', 'voluntary', 'conduct_violation'],
};
export const AFTER_2 = { ...RULES, disqualifyAfter: 2 };
export const CARD_OUT = { ...RULES, firstCardOut: true };
export const NO_2ND = { ...RULES, secondCardOut: false };

const boutId = (n) => `dddddddd-0000-4000-8000-0000001600${String(n).padStart(2, '0')}`;

/** A forfeit of the Fighter on a bout of its own; its id. */
export async function forfeit(
  sp,
  n,
  { outcome = null, reason = 'injury', parent = null, auto = false, underHand = false } = {},
) {
  await sp`INSERT INTO matches (id, phase_id, match_rules_id) VALUES (${boutId(n)}, ${PHASE}, ${SEED_COPY})`;
  const [row] = await sp`
    INSERT INTO match_forfeits (match_id, tournament_id, forfeiting_registration_id,
                                winner_registration_id, reason, score_policy, fighter_outcome,
                                parent_forfeit_id, auto_created, under_hand_withdrawal)
    VALUES (${boutId(n)}, ${TOURNAMENT}, ${FIGHTER}, ${OPPONENT}, ${reason}, 'fixed_loss',
            ${outcome}, ${parent}, ${auto}, ${underHand})
    RETURNING id`;
  return row.id;
}

export const voidForfeit = (sp, id) =>
  sp`UPDATE match_forfeits SET voided_at = ${NOW} WHERE id = ${id}`;

/** A black card of the Fighter on the seed's bout; its id. */
export async function card(sp, sequence) {
  const [row] = await sp`
    INSERT INTO match_penalties (client_uuid, match_id, tournament_id, registration_id, sequence,
                                 card, occurred_at)
    VALUES (gen_random_uuid(), ${BOUT}, ${TOURNAMENT}, ${FIGHTER}, ${100 + sequence}, 'black',
            ${NOW})
    RETURNING id`;
  return row.id;
}

export const voidCard = (sp, id) => sp`UPDATE match_penalties SET voided = true WHERE id = ${id}`;

export const twoCards = async (sp) => [await card(sp, 1), await card(sp, 2)];

/** A second black card review of the Fighter counting `counted`, its answer covering `answered`. */
export const review = (sp, status, answered, counted = answered) => sp`
  INSERT INTO tournament_penalty_reviews (tournament_id, registration_id, status, black_card_count,
                                          payload_json)
  VALUES (${TOURNAMENT}, ${FIGHTER}, ${status}, ${counted.length},
          ${sp.json({ penaltyIds: counted, answeredPenaltyIds: answered })})`;

/** The settle of the Fighter; what it answers. */
export const settle = async (
  sp,
  rules,
  { entry = null, expected = null, clear = false, now = NOW } = {},
) =>
  (
    await sp`SELECT public.settle_fighter_status(${FIGHTER}::uuid, ${sp.json(rules)},
               ${now}::timestamptz, ${entry}::text, ${expected}::text, ${clear}) AS r`
  )[0].r;

/** The Fighter's status columns, the spell out as an ISO string. */
export const rowOf = async (sp) =>
  (
    await sp`SELECT status, entry_status, waitlist_position,
                    to_char(out_since AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS out_since
             FROM registrations WHERE id = ${FIGHTER}`
  )[0];

/** The Fighter put on the waitlist, first in it. */
export const onWaitlist = (sp) =>
  sp`UPDATE registrations SET status = 'waitlist', entry_status = 'waitlist', waitlist_position = 1
     WHERE id = ${FIGHTER}`;
