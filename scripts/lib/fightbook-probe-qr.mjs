/**
 * The scenarios of `scripts/db-fightbook-probe.mjs` for slice 5 (migration 0270), part two: the QR
 * scan, `fightbook_qr_log`, and the block clause 0270 adds to `fightbook_answer` (Decision 12b).
 * Every refusal but `bad_code` must leave the code scannable: each refused-scan check reads the
 * word AND the code still there. Same transaction, same savepoints, same service role as the
 * slice 1 scenarios. Two scans of one code AT ONCE are the race probe's.
 */
import { createHash, randomBytes } from 'node:crypto';

import { F, answer, ask } from './fightbook-probe-scenarios.mjs';
import { EVENT } from './fightbook-probe-flags.mjs';
import { HOUR, NOT_LIVE, at, blockRow, word, wordsAfter } from './fightbook-probe-floor.mjs';
import { check, scenario } from './merge-probe-fixture.mjs';

/** A code on the shower's phone: the row holds the sha256 hex of a raw code nobody keeps. */
async function showCode(q, shower, { expires = at(300_000) } = {}) {
  const hash = createHash('sha256').update(randomBytes(16)).digest('hex');
  await q`INSERT INTO fightbook_qr_codes (token_hash, global_person_id, expires_at)
    VALUES (${hash}, ${shower}, ${expires})`;
  return hash;
}

/** A scan; a free date at "Salle" unless told otherwise. */
const scan = (q, hash, scanner, { kind = 'free', event = null, place = 'Salle' } = {}) =>
  q`SELECT public.fightbook_qr_log(${hash}, ${scanner}, ${kind}, ${event}, '2026-05-22'::date,
      'Europe/Paris', ${place}, ARRAY['Longsword'], ${at(6 * HOUR)}::timestamptz) AS r`.then(
    (rows) => rows[0].r,
  );

const codeLeft = (q, hash) =>
  q`SELECT count(*)::int AS n FROM fightbook_qr_codes WHERE token_hash = ${hash}`.then(
    (rows) => rows[0].n,
  );

const request = (q, requestId) =>
  q`SELECT status, asker_global_person_id AS asker, receiver_global_person_id AS receiver
      FROM spar_requests WHERE id = ${requestId}`.then((rows) => rows[0]);

/** A refused scan: its word, then whether the code is still there to scan (1) or burnt (0). */
const refusedScan = async (q, hash, scanner, how, setup = async () => {}) => [
  await word(q, async (sp) => {
    await setup(sp);
    await scan(sp, hash, scanner, how);
  }),
  await codeLeft(q, hash),
];

const onRoster = (q, profile) =>
  q`INSERT INTO persons (event_id, given_name, family_name, global_person_id)
      VALUES (${EVENT}, 'Probe', 'Roster', ${profile})`;

// ── A scan, and a code used once ────────────────────────────────────────────
export async function scanning(tx) {
  await scenario(tx, async (q) => {
    const hash = await showCode(q, F.julie);
    const r = await scan(q, hash, F.marc);
    const row = await request(q, r.id);
    check(
      'a scan asks the shower, and tells the API to notify her',
      [row?.status, row?.asker, row?.receiver, r.notify],
      ['pending', F.marc, F.julie, true],
    );
    check('a scan burns its code', await codeLeft(q, hash), 0);
    check('the same code again', await word(q, (sp) => scan(sp, hash, F.paul)), 'bad_code');
    const old = await showCode(q, F.julie, { expires: at(-1_000) });
    check('a code past its five minutes', await refusedScan(q, old, F.paul), ['bad_code', 1]);
  });
  await scenario(tx, async (q) => {
    const stale = await ask(q, F.marc, F.julie, { expires: at(-60_000) });
    const r = await scan(q, await showCode(q, F.julie), F.marc);
    check(
      'a scan ends a request past its end and lands a new one',
      [(await request(q, stale.id)).status, (await request(q, r.id)).status],
      ['not_this_time', 'pending'],
    );
  });
}

// ── Every refusal after the claim leaves the code scannable ─────────────────
export async function scanRefusals(tx) {
  await scenario(tx, async (q) => {
    const hash = await showCode(q, F.julie);
    check('scanning your own code', await refusedScan(q, hash, F.julie), ['self', 1]);
    const each = async (setups, scanner, how) => [
      await wordsAfter(q, setups, (sp) => scan(sp, hash, scanner, how)),
      await codeLeft(q, hash),
    ];
    check('a scan by a fighter not live', await each(NOT_LIVE(F.marc, F.paul), F.marc), [
      Array(5).fill('fightbook_off'),
      1,
    ]);
    check('a scan of a shower not live', await each(NOT_LIVE(F.julie, F.paul), F.marc), [
      Array(5).fill('not_on_fightbook'),
      1,
    ]);
    check(
      'a scan of a fighter the scanner blocked',
      await refusedScan(q, hash, F.marc, {}, (sp) => blockRow(sp, F.marc, F.julie)),
      ['you_blocked', 1],
    );
    check(
      'an Event scan of a shower off its roster',
      await refusedScan(q, hash, F.marc, { kind: 'event', event: EVENT, place: null }),
      ['bad_event', 1],
    );
  });
}

export async function scanShapes(tx) {
  await scenario(tx, async (q) => {
    const hash = await showCode(q, F.julie);
    // 0263's spar_requests_kind_shape, answered as a word. The Event one has the shower on the
    // roster, so only its place can refuse it.
    const shapes = [
      [{ kind: 'other' }],
      [{ kind: 'free', event: EVENT }],
      [{ kind: 'free', place: null }],
      [{ kind: 'free', place: '  ' }],
      [{ kind: 'event', event: EVENT, place: 'Salle' }, (sp) => onRoster(sp, F.julie)],
    ];
    const shapeWords = [];
    for (const [how, setup] of shapes)
      shapeWords.push((await refusedScan(q, hash, F.marc, how, setup))[0]);
    check(
      'a scan of the wrong shape: kind, an Event on a free date, no place, a place at an Event',
      [shapeWords, await codeLeft(q, hash)],
      [Array(5).fill('bad_event'), 1],
    );
    check(
      'a scan with a request already waiting',
      await refusedScan(q, hash, F.marc, {}, (sp) => ask(sp, F.marc, F.julie)),
      ['already_asked', 1],
    );
    // The control: the same code, an Event scan of a shower on the roster, goes through.
    await onRoster(q, F.julie);
    const r = await scan(q, hash, F.marc, { kind: 'event', event: EVENT, place: null });
    check('the same code, a scan of the right shape', (await request(q, r.id))?.status, 'pending');
  });
}

// ── A scan by a fighter the shower blocked (rulings 714, Decision 12b) ──────
export async function scanBlockedByShower(tx) {
  await scenario(tx, async (q) => {
    await blockRow(q, F.julie, F.marc);
    const r = await scan(q, await showCode(q, F.julie), F.marc);
    check(
      'a scan by a fighter the shower blocked waits as any ask, with no notice',
      [(await request(q, r.id))?.status, r.notify],
      ['pending', false],
    );
    // Still open (its end is hours away): only the block clause can refuse this yes.
    check(
      'the shower agreeing a request from a fighter she blocked',
      await word(q, (sp) => answer(sp, r.id, F.julie, 'yes')),
      'not_open',
    );
  });
}
