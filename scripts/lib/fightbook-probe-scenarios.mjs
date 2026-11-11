/**
 * The seed, the calls and the scenarios of `scripts/db-fightbook-probe.mjs` (FightBook slice 1).
 * Everything runs inside the probe's one transaction, always rolled back; each scenario runs as
 * the service role in its own savepoint (`scenario`, from the merge probe's fixture).
 */
import { check, id, refusal, scenario, words } from './merge-probe-fixture.mjs';

/** Accounts, then profiles: Marc asks, Julie answers, Paul is a third fighter. */
const U = { marc: id(1), julie: id(2), paul: id(3) };
export const F = { marc: id(11), julie: id(12), paul: id(13) };
const E = { a: id(21), b: id(22) };
const DAY = '2026-05-22';

export async function seed(tx) {
  await tx`INSERT INTO auth.users (id) SELECT unnest(${Object.values(U)}::uuid[])`;
  await tx`INSERT INTO organizations (id, slug, name) VALUES (${id(20)}, 'fightbook-probe', 'FightBook Probe')`;
  await tx`INSERT INTO events (id, organization_id, slug, name, start_date, end_date) VALUES
    (${E.a}, ${id(20)}, 'fb-probe-a', 'Probe A', ${DAY}, ${DAY}),
    (${E.b}, ${id(20)}, 'fb-probe-b', 'Probe B', ${DAY}, ${DAY})`;
  await tx`INSERT INTO global_persons
      (id, slug, display_name, given_name, family_name, claimed_by_user_id, fightbook_enabled)
    VALUES
      (${F.marc}, 'fb-marc', 'Marc', 'Marc', 'Probe', ${U.marc}, true),
      (${F.julie}, 'fb-julie', 'Julie', 'Julie', 'Probe', ${U.julie}, true),
      (${F.paul}, 'fb-paul', 'Paul', 'Paul', 'Probe', ${U.paul}, true)`;
}

// ── Calls ───────────────────────────────────────────────────────────────────
const HOUR_AHEAD = () => new Date(Date.now() + 3_600_000).toISOString();

/** An ask; `event` names the Event (kind event), else a free date at "Salle". */
export const ask = (q, asker, receiver, { event = E.a, expires = HOUR_AHEAD() } = {}) =>
  q`SELECT public.fightbook_ask(${asker}, ${receiver}, ${event ? 'event' : 'free'}, ${event},
      ${DAY}::date, 'Europe/Paris', NULL, ${event ? null : 'Salle'}, ARRAY['Longsword'], NULL,
      ${expires}::timestamptz) AS r`.then((rows) => rows[0].r);

const answer = (q, request, receiver, word, comment = null, shared = false) =>
  q`SELECT public.fightbook_answer(${request}, ${receiver}, ${word}, ${comment}, ${shared}) AS r`.then(
    (rows) => rows[0].r,
  );

const block = (q, blocker, blocked) => q`SELECT public.fightbook_block(${blocker}, ${blocked})`;

const refused = async (q, call) => {
  const raised = await refusal(q, call);
  return raised ? raised.message : null;
};

const statusOf = (q, request) =>
  q`SELECT status FROM spar_requests WHERE id = ${request}`.then((rows) => rows[0]?.status);

const row = (q, request) =>
  q`SELECT status, shared_comment, agreed_at IS NOT NULL AS agreed, event_id
      FROM spar_requests WHERE id = ${request}`.then((rows) => rows[0]);

const notesOn = (q, request) =>
  q`SELECT body FROM spar_private_notes WHERE spar_request_id = ${request}`.then((rows) =>
    rows.map((r) => r.body),
  );

// ── Asking ──────────────────────────────────────────────────────────────────
export async function asking(tx) {
  await scenario(tx, async (q) => {
    const first = await ask(q, F.marc, F.julie);
    check('an ask waits for an answer', first.status, 'pending');
    check(
      'one waiting request per pair',
      await refused(q, (sp) => ask(sp, F.marc, F.julie, { event: E.b })),
      'already_asked',
    );
    check('asking yourself', await refused(q, (sp) => ask(sp, F.marc, F.marc)), 'self');
  });
  await scenario(tx, async (q) => {
    await q`UPDATE global_persons SET fightbook_enabled = false WHERE id = ${F.julie}`;
    check('receiver off', await refused(q, (sp) => ask(sp, F.marc, F.julie)), 'not_on_fightbook');
    await q`UPDATE global_persons SET fightbook_enabled = true, account_deleted_at = now() WHERE id = ${F.julie}`;
    check(
      'receiver erased',
      await refused(q, (sp) => ask(sp, F.marc, F.julie)),
      'not_on_fightbook',
    );
    await q`UPDATE global_persons SET fightbook_enabled = false WHERE id = ${F.marc}`;
    check('asker off', await refused(q, (sp) => ask(sp, F.marc, F.paul)), 'fightbook_off');
  });
  await scenario(tx, async (q) => {
    await block(q, F.marc, F.julie);
    check(
      'asking someone you blocked',
      await refused(q, (sp) => ask(sp, F.marc, F.julie)),
      'you_blocked',
    );
  });
}

// ── No asking twice, and a stale request ────────────────────────────────────
export async function noAskingTwice(tx) {
  await scenario(tx, async (q) => {
    const first = await ask(q, F.marc, F.julie);
    await answer(q, first.id, F.julie, 'no');
    check('same Event after a no', await refused(q, (sp) => ask(sp, F.marc, F.julie)), 'not_again');
    check(
      'another Event after a no',
      (await ask(q, F.marc, F.julie, { event: E.b })).status,
      'pending',
    );
  });
  await scenario(tx, async (q) => {
    const free = await ask(q, F.marc, F.julie, { event: null });
    await answer(q, free.id, F.julie, 'no');
    await q`UPDATE spar_requests SET expires_at = now() - interval '6 days' WHERE id = ${free.id}`;
    check(
      'free date, 6 days after the day',
      await refused(q, (sp) => ask(sp, F.marc, F.julie, { event: null })),
      'not_again',
    );
    await q`UPDATE spar_requests SET expires_at = now() - interval '8 days' WHERE id = ${free.id}`;
    check(
      'free date, 8 days after the day',
      (await ask(q, F.marc, F.julie, { event: null })).status,
      'pending',
    );
  });
  await scenario(tx, async (q) => {
    const stale = await ask(q, F.marc, F.julie, {
      expires: new Date(Date.now() - 60_000).toISOString(),
    });
    check(
      'answering a request past its end',
      await refused(q, (sp) => answer(sp, stale.id, F.julie, 'yes')),
      'not_open',
    );
    check(
      'a new ask for another Event passes a stale one',
      (await ask(q, F.marc, F.julie, { event: E.b })).status,
      'pending',
    );
    check('the stale one ended as a no', await statusOf(q, stale.id), 'not_this_time');
  });
}

// ── Answering ───────────────────────────────────────────────────────────────
export async function answering(tx) {
  await scenario(tx, async (q) => {
    const r = await ask(q, F.marc, F.julie);
    check('a yes agrees', (await answer(q, r.id, F.julie, 'yes')).status, 'agreed');
    check('a second answer', await refused(q, (sp) => answer(sp, r.id, F.julie, 'no')), 'not_open');
    check(
      'a stranger answering',
      await refused(q, (sp) => answer(sp, r.id, F.paul, 'yes')),
      'not_open',
    );
  });
  await scenario(tx, async (q) => {
    const r = await ask(q, F.marc, F.julie);
    await q`UPDATE spar_requests SET status = 'withdrawn' WHERE id = ${r.id}`;
    check(
      'answering a withdrawn request',
      await refused(q, (sp) => answer(sp, r.id, F.julie, 'yes')),
      'not_open',
    );
    const s = await ask(q, F.marc, F.julie, { event: E.b });
    check(
      'an answer word that is not yes or no',
      await refused(q, (sp) => answer(sp, s.id, F.julie, 'maybe')),
      'bad_answer',
    );
    await q`UPDATE global_persons SET fightbook_enabled = false WHERE id = ${F.marc}`;
    check(
      'answering an asker who switched off',
      await refused(q, (sp) => answer(sp, s.id, F.julie, 'yes')),
      'not_open',
    );
  });
  await scenario(tx, async (q) => {
    const kept = await ask(q, F.marc, F.julie);
    await answer(q, kept.id, F.julie, 'no', 'Not my weapon', false);
    const r1 = await row(q, kept.id);
    check(
      'a private comment never reaches the row',
      [r1.status, r1.shared_comment],
      ['not_this_time', null],
    );
    check('a private comment is the decliner’s note', await notesOn(q, kept.id), ['Not my weapon']);
    const shown = await ask(q, F.paul, F.julie);
    await answer(q, shown.id, F.julie, 'no', 'Next Event!', true);
    check(
      'a shown comment is on the row, not a note',
      [(await row(q, shown.id)).shared_comment, await notesOn(q, shown.id)],
      ['Next Event!', []],
    );
    const yes = await ask(q, F.julie, F.paul);
    await answer(q, yes.id, F.paul, 'yes', 'ignored', true);
    const r3 = await row(q, yes.id);
    check(
      'a yes keeps no comment',
      [r3.agreed, r3.shared_comment, await notesOn(q, yes.id)],
      [true, null, []],
    );
  });
}

// ── Blocking ────────────────────────────────────────────────────────────────
export async function blocking(tx) {
  await scenario(tx, async (q) => {
    const theirs = await ask(q, F.marc, F.julie);
    const mine = await ask(q, F.julie, F.marc);
    await block(q, F.julie, F.marc);
    check(
      "the blocked fighter's waiting request ends as a no",
      await statusOf(q, theirs.id),
      'not_this_time',
    );
    check(
      "the blocker's own waiting request is withdrawn",
      await statusOf(q, mine.id),
      'withdrawn',
    );
    const blocked = await ask(q, F.marc, F.julie, { event: E.b });
    check('a blocked ask is answered like any ask, as a no', blocked.status, 'not_this_time');
    check('blocking twice', await refused(q, (sp) => block(sp, F.julie, F.marc)), null);
    check('blocking yourself', await refused(q, (sp) => block(sp, F.julie, F.julie)), 'self');
    const unknown = await refusal(q, (sp) => block(sp, F.julie, id(99)));
    check('blocking nobody', unknown, words('P0002', 'not_found'));
  });
  await scenario(tx, async (q) => {
    const r = await ask(q, F.marc, F.julie);
    await answer(q, r.id, F.julie, 'yes');
    await block(q, F.julie, F.marc);
    check('a block leaves an agreed spar agreed', await statusOf(q, r.id), 'agreed');
  });
}

// ── The table holds its shape; an Event delete keeps the request ────────────
export async function tableShape(tx) {
  const insert = (q, cols) =>
    q`INSERT INTO spar_requests ${q({
      asker_global_person_id: F.marc,
      receiver_global_person_id: F.julie,
      spar_day: DAY,
      zone: 'Europe/Paris',
      weapons: ['Longsword'],
      expires_at: HOUR_AHEAD(),
      ...cols,
    })}`;
  await scenario(tx, async (q) => {
    const code = async (cols) => (await refusal(q, (sp) => insert(sp, cols)))?.code ?? null;
    check('a free date without a place', await code({ kind: 'free' }), '23514');
    check(
      'cancelled without who cancelled',
      await code({ kind: 'event', status: 'cancelled', agreed_at: new Date().toISOString() }),
      '23514',
    );
    check(
      'six weapons',
      await code({ kind: 'event', weapons: ['a', 'b', 'c', 'd', 'e', 'f'] }),
      '23514',
    );
    const r = await ask(q, F.marc, F.julie);
    await q`RESET ROLE`;
    await q`DELETE FROM events WHERE id = ${E.a}`;
    await q`SET LOCAL ROLE service_role`;
    const kept = await row(q, r.id);
    check(
      'deleting the Event keeps the request',
      [kept?.status, kept?.event_id],
      ['pending', null],
    );
  });
}

export const FUNCTIONS = [
  'public.fightbook_ask(uuid, uuid, text, uuid, date, text, time without time zone, text, text[], text, timestamp with time zone)',
  'public.fightbook_answer(uuid, uuid, text, text, boolean)',
  'public.fightbook_block(uuid, uuid)',
];
