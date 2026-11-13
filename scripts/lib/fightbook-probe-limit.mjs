/**
 * The scenarios of `scripts/db-fightbook-probe.mjs` for slice 6 (migration 0271): the daily limit
 * (rulings 741-744, 747). Each case is one scenario and one check (`scenarioCheck`): the stored
 * status of a new ask to Julie, on day D unless named. A limit-stopped ask is the declined row;
 * a Yes, a QR scan, a pick and her own ask never read the limit. Same transaction, same savepoints,
 * same service role as the slice 1 scenarios.
 */
import { createHash, randomBytes } from 'node:crypto';

import { F, answer } from './fightbook-probe-scenarios.mjs';
import { EVENT, eventSpar } from './fightbook-probe-flags.mjs';
import { brokenCheck } from './fightbook-probe-reviews.mjs';
import { HOUR, at, postCall, word } from './fightbook-probe-floor.mjs';
import { ROLLBACK, id, refusal, rolledBack, scenarioCheck, words } from './merge-probe-fixture.mjs';

/** Two more fighters, live with FightBook on: Hugo posts open calls, Lea has no limit. */
const H = { hugo: id(131), lea: id(132), gone: id(133) };
const D = '2026-05-22';
const D1 = '2026-05-23';

export async function seedLimit(tx) {
  await tx`INSERT INTO auth.users (id) VALUES (${id(121)}), (${id(122)})`;
  await tx`INSERT INTO global_persons
      (id, slug, display_name, given_name, family_name, claimed_by_user_id, fightbook_enabled)
    VALUES
      (${H.hugo}, 'fb-hugo', 'Hugo', 'Hugo', 'Probe', ${id(121)}, true),
      (${H.lea}, 'fb-lea', 'Lea', 'Lea', 'Probe', ${id(122)}, true)`;
}

// ── Calls ───────────────────────────────────────────────────────────────────
const setLimit = (q, profile, n) =>
  q`INSERT INTO fightbook_daily_limits (global_person_id, daily_limit) VALUES (${profile}, ${n})`;

/** An ask for `day`; `event` names the Event, null a free date at "Salle". */
const askOn = (q, asker, receiver, day = D, { event = EVENT, expires = at(HOUR) } = {}) =>
  q`SELECT public.fightbook_ask(${asker}, ${receiver}, ${event ? 'event' : 'free'}, ${event},
      ${day}::date, 'Europe/Paris', NULL, ${event ? null : 'Salle'}, ARRAY['Longsword'], NULL,
      ${expires}::timestamptz) AS r`.then((rows) => rows[0].r);

const statusOf = (q, request) =>
  q`SELECT status FROM spar_requests WHERE id = ${request}`.then((rows) => rows[0]?.status);

/** Marc's new ask to Julie: its STORED status. */
const marcAsks = async (q, day = D, how = {}) =>
  statusOf(q, (await askOn(q, F.marc, F.julie, day, how)).id);

/** Julie at a limit of 2: a spar she asked (Paul) and one she received (Hugo), agreed on D. */
async function atHerLimit(q) {
  await setLimit(q, F.julie, 2);
  await eventSpar(q, F.julie, F.paul);
  return eventSpar(q, H.hugo, F.julie);
}

const NO = 'not_this_time';

/** `run`'s value, in a savepoint rolled back with everything it wrote. */
async function undone(q, run) {
  let value;
  await rolledBack(() =>
    q.savepoint(async (sp) => {
      value = await run(sp);
      throw ROLLBACK;
    }),
  );
  return value;
}

// ── What counts (rulings 741, 744) ──────────────────────────────────────────
export async function limitCounts(tx) {
  await scenarioCheck(
    tx,
    'L1 no limit, five agreed on the day: a new ask waits',
    'pending',
    async (q) => {
      for (let n = 0; n < 5; n += 1) await eventSpar(q, F.paul, F.julie);
      return marcAsks(q);
    },
  );
  await scenarioCheck(tx, 'L4 one done and one agreed on the day, limit 2', NO, async (q) => {
    await setLimit(q, F.julie, 2);
    await eventSpar(q, F.julie, F.paul, { status: 'done' });
    await eventSpar(q, H.hugo, F.julie);
    return marcAsks(q);
  });
  await scenarioCheck(
    tx,
    'L5 one agreed, limit 2, and one cancelled, pending, withdrawn or ended spar each: not counted',
    Array(4).fill('pending'),
    async (q) => {
      await setLimit(q, F.julie, 2);
      await eventSpar(q, F.paul, F.julie);
      const stored = [];
      for (const status of ['cancelled', 'pending', 'withdrawn', NO]) {
        // Each in its own savepoint: Marc's ask, waiting, would refuse the next one already_asked.
        stored.push(
          await undone(q, async (sp) => {
            await eventSpar(sp, F.julie, H.hugo, { status });
            return marcAsks(sp);
          }),
        );
      }
      return stored;
    },
  );
  await scenarioCheck(
    tx,
    'L6 an Event spar and a free-date spar on the day, limit 2',
    NO,
    async (q) => {
      await setLimit(q, F.julie, 2);
      await eventSpar(q, F.paul, F.julie);
      await eventSpar(q, F.julie, H.hugo, { kind: 'free', event_id: null, place: 'Salle' });
      return marcAsks(q);
    },
  );
}

// ── A full day stores the declined row (ruling 741) ─────────────────────────
export async function limitStops(tx) {
  await scenarioCheck(
    tx,
    'L2 at her limit: stored ended, the declined row column for column, no agreed_at, no comment',
    [NO, true, null, null],
    async (q) => {
      const expires = at(HOUR);
      const declined = await askOn(q, F.paul, F.julie, D, { expires });
      await answer(q, declined.id, F.julie, 'no');
      await atHerLimit(q);
      const stopped = await askOn(q, F.marc, F.julie, D, { expires });
      // everyNoIsOneRow's comparison (fightbook-probe-scenarios.mjs): all but ids and times.
      const rows = await q`
        SELECT to_jsonb(r) - 'id' - 'created_at' - 'asker_global_person_id' AS body,
               agreed_at, shared_comment
          FROM spar_requests r WHERE r.id IN (${declined.id}, ${stopped.id})
         ORDER BY r.id = ${stopped.id}`;
      const mine = rows[1] ?? {};
      return [
        await statusOf(q, stopped.id),
        JSON.stringify(rows[0]?.body) === JSON.stringify(mine.body),
        mine.agreed_at,
        mine.shared_comment,
      ];
    },
  );
  await scenarioCheck(tx, 'L3 at her limit on D, an ask for D+1 waits', 'pending', async (q) => {
    await atHerLimit(q);
    return statusOf(q, (await askOn(q, H.lea, F.julie, D1)).id);
  });
}

// ── A limit stop is a "no" like any other (ruling 747) ──────────────────────
export async function limitNotAgain(tx) {
  await scenarioCheck(
    tx,
    'L7 a cancel frees a place, but the stopped asker asks again: not_again for D and D+1',
    [NO, 'not_again', 'not_again', 'pending'],
    async (q) => {
      const hugos = await atHerLimit(q);
      const first = await marcAsks(q);
      await q`UPDATE spar_requests SET status = 'cancelled', cancelled_by = 'receiver'
        WHERE id = ${hugos}`;
      return [
        first,
        await word(q, (sp) => askOn(sp, F.marc, F.julie, D)),
        await word(q, (sp) => askOn(sp, F.marc, F.julie, D1)),
        // The control: the freed place takes a NEW asker's ask for D.
        await statusOf(q, (await askOn(q, H.lea, F.julie, D)).id),
      ];
    },
  );
  await scenarioCheck(
    tx,
    'L7 a free date stopped by the limit: another free date inside 7 days is not_again',
    [NO, 'not_again'],
    async (q) => {
      await atHerLimit(q);
      return [
        await marcAsks(q, D, { event: null }),
        await word(q, (sp) => askOn(sp, F.marc, F.julie, '2026-05-25', { event: null })),
      ];
    },
  );
}

// ── What the limit never stops (rulings 742, 743) ───────────────────────────
async function showCode(q, shower) {
  const hash = createHash('sha256').update(randomBytes(16)).digest('hex');
  await q`INSERT INTO fightbook_qr_codes (token_hash, global_person_id, expires_at)
    VALUES (${hash}, ${shower}, ${at(300_000)})`;
  return hash;
}

export async function limitPassThrough(tx) {
  await scenarioCheck(
    tx,
    'L8 at her limit, her Yes on an ask already waiting',
    ['agreed', 'agreed'],
    async (q) => {
      const waiting = await askOn(q, F.marc, F.julie);
      await atHerLimit(q);
      const answered = await answer(q, waiting.id, F.julie, 'yes');
      return [answered.status, await statusOf(q, waiting.id)];
    },
  );
  await scenarioCheck(tx, 'L9 at her limit, Marc scans her QR code', 'pending', async (q) => {
    await atHerLimit(q);
    const hash = await showCode(q, F.julie);
    const [{ r }] = await q`SELECT public.fightbook_qr_log(${hash}, ${F.marc}, 'free', NULL,
        ${D}::date, 'Europe/Paris', 'Salle', ARRAY['Longsword'], ${at(6 * HOUR)}::timestamptz) AS r`;
    return statusOf(q, r.id);
  });
  await scenarioCheck(
    tx,
    'L10 at her limit, Hugo picks her from his open call',
    'agreed',
    async (q) => {
      await atHerLimit(q);
      const call = await postCall(q, H.hugo);
      await q`INSERT INTO spar_open_call_answers (call_id, answerer_global_person_id)
      VALUES (${call}, ${F.julie})`;
      const [{ r }] =
        await q`SELECT public.fightbook_call_pick(${call}, ${H.hugo}, ${F.julie}, ${at(6 * HOUR)}::timestamptz) AS r`;
      return statusOf(q, r);
    },
  );
  await scenarioCheck(
    tx,
    'L11 at her limit, Julie asks Lea, who has none',
    'pending',
    async (q) => {
      await atHerLimit(q);
      return statusOf(q, (await askOn(q, F.julie, H.lea)).id);
    },
  );
}

// ── The table holds its shape ───────────────────────────────────────────────
export async function limitTableShape(tx) {
  const range = 'fightbook_daily_limits_range';
  await scenarioCheck(
    tx,
    'L12 a limit of 0 and of 21 refused by name, 1 and 20 kept, a second row for one profile',
    [
      [range, range, null, null],
      words(
        '23505',
        'duplicate key value violates unique constraint "fightbook_daily_limits_person_uk"',
      ),
    ],
    async (q) => {
      const named = [];
      for (const n of [0, 21, 1, 20])
        named.push(await brokenCheck(q, (sp) => setLimit(sp, F.julie, n)));
      await setLimit(q, F.julie, 3);
      return [named, await refusal(q, (sp) => setLimit(sp, F.julie, 4))];
    },
  );
  await scenarioCheck(tx, 'L13 a profile deleted takes its limit with it', [1, 0], async (q) => {
    await q`INSERT INTO global_persons (id, slug, display_name, given_name, family_name)
      VALUES (${H.gone}, 'fb-gone', 'Gone', 'Gone', 'Probe')`;
    await setLimit(q, H.gone, 4);
    const count = () =>
      q`SELECT count(*)::int AS n FROM fightbook_daily_limits WHERE global_person_id = ${H.gone}`.then(
        (rows) => rows[0].n,
      );
    const before = await count();
    await q`RESET ROLE`;
    await q`DELETE FROM global_persons WHERE id = ${H.gone}`;
    await q`SET LOCAL ROLE service_role`;
    return [before, await count()];
  });
}
