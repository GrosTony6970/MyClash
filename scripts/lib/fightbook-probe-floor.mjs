/**
 * The scenarios of `scripts/db-fightbook-probe.mjs` for slice 5 (migration 0270), part one: open
 * calls. `fightbook_call_pick` (the pick and each refusal), `fightbook_block`'s new withdrawal from
 * the blocked fighter's calls, and the CHECKs of the new tables. The QR scans are in
 * fightbook-probe-qr.mjs. Same transaction, same savepoints, same service role as the slice 1
 * scenarios. Two picks AT ONCE are the race probe's (`scripts/db-fightbook-race-probe.mjs`).
 */
import { F } from './fightbook-probe-scenarios.mjs';
import { EVENT } from './fightbook-probe-flags.mjs';
import { brokenCheck } from './fightbook-probe-reviews.mjs';
import { check, refusal, scenario } from './merge-probe-fixture.mjs';

export const HOUR = 3_600_000;
export const at = (ms) => new Date(Date.now() + ms).toISOString();

/** The word a call raised in its own savepoint (rolled back with whatever `call` wrote), or null. */
export const word = async (q, call) => (await refusal(q, call))?.message ?? null;

/**
 * The five ways a profile is not live (0264's predicate, one clause each): FightBook off, no
 * account, merged away (into `into`), deleted, its account erased. Each runs in the savepoint of
 * the call it precedes, so the next starts from a live profile again.
 */
export const NOT_LIVE = (profile, into) =>
  [
    'fightbook_enabled = false',
    'claimed_by_user_id = NULL',
    `merged_into_id = '${into}'`,
    'deleted_at = now()',
    'account_deleted_at = now()',
  ].map((set) => (q) => q.unsafe(`UPDATE global_persons SET ${set} WHERE id = '${profile}'`));

/** The word `call` raised after each setup, in turn. */
export async function wordsAfter(q, setups, call) {
  const words = [];
  for (const setup of setups) {
    words.push(
      await word(q, async (sp) => {
        await setup(sp);
        await call(sp);
      }),
    );
  }
  return words;
}

export const blockRow = (q, blocker, blocked) =>
  q`INSERT INTO fightbook_blocks (blocker_global_person_id, blocked_global_person_id)
      VALUES (${blocker}, ${blocked})`;

// ── Calls ───────────────────────────────────────────────────────────────────
export const postCall = (q, poster, { closes = at(HOUR), ...more } = {}) =>
  q`INSERT INTO spar_open_calls ${q({
    poster_global_person_id: poster,
    event_id: EVENT,
    spar_day: '2026-05-22',
    zone: 'Europe/Paris',
    spar_time: '14:00',
    weapons: ['Longsword'],
    closes_at: closes,
    ...more,
  })} RETURNING id`.then((rows) => rows[0].id);

const imIn = (q, call, answerer) =>
  q`INSERT INTO spar_open_call_answers (call_id, answerer_global_person_id) VALUES (${call}, ${answerer})`;

const pick = (q, call, poster, answerer, expires = at(6 * HOUR)) =>
  q`SELECT public.fightbook_call_pick(${call}, ${poster}, ${answerer}, ${expires}::timestamptz) AS r`.then(
    (rows) => rows[0].r,
  );

const hasAnswered = (q, call, answerer) =>
  q`SELECT count(*)::int AS n FROM spar_open_call_answers
      WHERE call_id = ${call} AND answerer_global_person_id = ${answerer}`.then(
    (r) => r[0].n === 1,
  );

/** Julie's call, answered by Marc. */
async function answeredCall(q, more) {
  const call = await postCall(q, F.julie, more);
  await imIn(q, call, F.marc);
  return call;
}

// ── The pick ────────────────────────────────────────────────────────────────
export async function picking(tx) {
  await scenario(tx, async (q) => {
    const call = await answeredCall(q);
    await imIn(q, call, F.paul);
    const expires = at(6 * HOUR);
    const spar = await pick(q, call, F.julie, F.marc, expires);
    const [s] = await q`SELECT status, asker_global_person_id AS asker,
        receiver_global_person_id AS receiver, kind, event_id, spar_time::text AS time, weapons,
        agreed_at IS NOT NULL AS agreed, expires_at = ${expires}::timestamptz AS ends
      FROM spar_requests WHERE id = ${spar}`;
    check(
      'a pick agrees a spar the poster asked, on the call',
      [
        s?.status,
        s?.asker,
        s?.receiver,
        s?.kind,
        s?.event_id,
        s?.time,
        s?.weapons,
        s?.agreed,
        s?.ends,
      ],
      ['agreed', F.julie, F.marc, 'event', EVENT, '14:00:00', ['Longsword'], true, true],
    );
    const [c] = await q`SELECT status, picked_global_person_id AS picked, spar_request_id AS spar
      FROM spar_open_calls WHERE id = ${call}`;
    check(
      'a pick marks the call picked, with its spar',
      [c.status, c.picked, c.spar],
      ['picked', F.marc, spar],
    );
    check('a second pick', await word(q, (sp) => pick(sp, call, F.julie, F.paul)), 'not_open');
  });
}

export async function pickRefusals(tx) {
  await scenario(tx, async (q) => {
    const past = await answeredCall(q, { closes: at(-60_000) });
    check(
      'a pick after the call closed',
      await word(q, (sp) => pick(sp, past, F.julie, F.marc)),
      'not_open',
    );
    const call = await answeredCall(q);
    check(
      'a pick of a fighter who did not answer',
      await word(q, (sp) => pick(sp, call, F.julie, F.paul)),
      'not_open',
    );
    check(
      'a pick by someone else than the poster',
      await word(q, (sp) => pick(sp, call, F.paul, F.marc)),
      'not_open',
    );
    await imIn(q, call, F.julie);
    check(
      'a poster picking herself',
      await word(q, (sp) => pick(sp, call, F.julie, F.julie)),
      'not_open',
    );
  });
}

export async function pickBlockedOrNotLive(tx) {
  await scenario(tx, async (q) => {
    const call = await answeredCall(q);
    const blocks = (blocker, target) => (sp) => blockRow(sp, blocker, target);
    check(
      'a pick across a block, each way',
      await wordsAfter(q, [blocks(F.julie, F.marc), blocks(F.marc, F.julie)], (sp) =>
        pick(sp, call, F.julie, F.marc),
      ),
      ['not_open', 'not_open'],
    );
    const notOpen = Array(5).fill('not_open');
    const picked = (sp) => pick(sp, call, F.julie, F.marc);
    check(
      'a pick of an answerer not live',
      await wordsAfter(q, NOT_LIVE(F.marc, F.paul), picked),
      notOpen,
    );
    check(
      'a pick by a poster not live',
      await wordsAfter(q, NOT_LIVE(F.julie, F.paul), picked),
      notOpen,
    );
    // The control: the same pick, nobody blocked and both live, goes through.
    check('the same pick with both live and no block', await word(q, picked), null);
  });
}

// ── A block withdraws the blocker from the blocked fighter's calls ──────────
export async function blockingCalls(tx) {
  await scenario(tx, async (q) => {
    const [julies, marcs, pauls] = [
      await postCall(q, F.julie),
      await postCall(q, F.marc),
      await postCall(q, F.paul),
    ];
    await imIn(q, julies, F.marc);
    await imIn(q, julies, F.paul);
    await imIn(q, marcs, F.julie);
    await imIn(q, pauls, F.marc);
    await q`SELECT public.fightbook_block(${F.marc}, ${F.julie})`;
    check(
      "the blocker's answer on the blocked fighter's call is gone",
      await hasAnswered(q, julies, F.marc),
      false,
    );
    check(
      "the blocked fighter's answer on the blocker's call stays",
      await hasAnswered(q, marcs, F.julie),
      true,
    );
    check(
      'a block takes no other answer',
      [await hasAnswered(q, pauls, F.marc), await hasAnswered(q, julies, F.paul)],
      [true, true],
    );
  });
}

// ── The new tables hold their shape ─────────────────────────────────────────
export async function floorTableShape(tx) {
  await scenario(tx, async (q) => {
    check(
      'a picked call naming nobody',
      await brokenCheck(q, (sp) => postCall(sp, F.julie, { status: 'picked' })),
      'spar_open_calls_status_shape',
    );
    check(
      'a call with six weapons',
      await brokenCheck(q, (sp) =>
        postCall(sp, F.julie, { weapons: ['a', 'b', 'c', 'd', 'e', 'f'] }),
      ),
      'spar_open_calls_weapons',
    );
    check(
      'a QR code hash of ten characters',
      await brokenCheck(
        q,
        (sp) => sp`INSERT INTO fightbook_qr_codes (token_hash, global_person_id, expires_at)
          VALUES ('0123456789', ${F.julie}, ${at(300_000)})`,
      ),
      'fightbook_qr_codes_hash',
    );
  });
}

export const FLOOR_FUNCTIONS = [
  'public.fightbook_call_pick(uuid, uuid, uuid, timestamp with time zone)',
  'public.fightbook_qr_log(text, uuid, text, uuid, date, text, text, text[], timestamp with time zone)',
];
