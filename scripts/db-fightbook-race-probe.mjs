/**
 * The FightBook race probe (slice 5, migration 0270): two picks of one open call, or two scans of
 * one QR code, AT ONCE, on two connections, on COMMITTED rows.
 *
 * Why it exists. The FightBook probe runs every rule in one transaction, one call after another:
 * it cannot show what two calls do when they overlap. Two fighters tapping at the same moment is
 * the common case on the floor. The rule that must win it lives in SQL: the pick's one conditional
 * UPDATE (`status = 'open'`) and the scan's delete-first claim of the code.
 *
 * How the overlap is made CERTAIN, never by repetition: connection A opens a transaction and makes
 * its call, and does not end it. Connection B makes its call. The probe then reads, from a third
 * connection, that B's backend is blocked by A's (`pg_blocking_pids`) and that B has not answered
 * 500 ms after it started. Only then does A commit (or roll back), and B's answer is checked.
 *
 * The races:
 *   - two picks of one call, each of a different answerer: A agrees a spar, B is `not_open`, the
 *     call holds one spar and names A's answerer;
 *   - two scans of one code: A's request is made, B is `bad_code`, the shower has one request;
 *   - a scan REFUSED after it claimed the code (A blocked the shower: `you_blocked`) while a second
 *     scan waits on the code: A's claim is undone, and B's scan then goes through with that same
 *     code. A refusal cannot be held open, so here A is held MID-CALL, after its claim, by a gate
 *     connection holding A's profile (`refusedThenScan`).
 * And the pair lock (0264's, taken by both functions): a block committed while a pick or a scan
 * waits on it is seen by that pick or scan, which refuses (`not_open`, `you_blocked`). And the
 * pick's FOR SHARE on the answer (Decision 10): a take-back during a pick waits, then lands.
 *
 * Not a race, but committed for the same reason (lib/fightbook-race-refusals.mjs): a refused scan
 * (`already_asked`, `bad_event`, `not_on_fightbook`) in a transaction of its own leaves its code,
 * and the same scanner then scans that same code. In the FightBook probe a refusal's savepoint
 * rolls back, which would restore a burnt code, so only committed transactions show this.
 *
 * Run it after `pnpm db:migrations:replay`, on the same disposable database. It COMMITS rows (its
 * fixture, deleted at its end whatever happened), so it runs only when told the database is
 * disposable:
 *   RACE_PROBE_DISPOSABLE=1 DATABASE_URL=postgres://… pnpm db:fightbook-race-probe
 * Each check counts itself; the probe fails when any fails, and when fewer ran than it declares.
 */
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import postgres from 'postgres';

import { refusedScansLeaveTheCode } from './lib/fightbook-race-refusals.mjs';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error(
    'DATABASE_URL is required and must point at a disposable, freshly replayed database (pnpm db:migrations:replay).',
  );
  process.exit(1);
}
if (process.env['RACE_PROBE_DISPOSABLE'] !== '1') {
  console.error(
    'The FightBook race probe commits rows: set RACE_PROBE_DISPOSABLE=1 to say DATABASE_URL names a disposable replay.',
  );
  process.exit(1);
}

const options = { max: 1, onnotice: () => {}, connection: { statement_timeout: 30_000 } };
const connA = postgres(databaseUrl, options);
const connB = postgres(databaseUrl, options);
const watch = postgres(databaseUrl, options);
const gate = postgres(databaseUrl, options);
const EXPECTED_CHECKS = 23;
const WAIT_MS = 500;

const fixture = (n) => `fb5a0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CLUB = fixture(1);
const EVENT = fixture(2);
/**
 * Accounts and their profiles: Julie posts three calls, Marc and Paul answer the first, Paul the
 * second, Marc the third; Paul shows codes; Lea blocked Paul.
 */
const U = { julie: fixture(11), marc: fixture(12), paul: fixture(13), lea: fixture(14) };
const F = { julie: fixture(21), marc: fixture(22), paul: fixture(23), lea: fixture(24) };
const CALL = fixture(31);
const SECOND_CALL = fixture(32);
const THIRD_CALL = fixture(33);

let checks = 0;
const failures = [];
function check(label, actual, expected) {
  checks += 1;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
}

// ── Fixture ─────────────────────────────────────────────────────────────────
async function seedCommitted() {
  const [{ n }] = await watch`SELECT count(*)::int AS n FROM organizations WHERE id = ${CLUB}`;
  if (n > 0)
    throw new Error(
      `the fixture's club ${CLUB} is already there: a run before left it; replay a fresh database`,
    );
  await watch.begin(async (tx) => {
    await tx`INSERT INTO auth.users (id) SELECT unnest(${Object.values(U)}::uuid[])`;
    await tx`INSERT INTO organizations (id, slug, name) VALUES (${CLUB}, 'fb-race-probe', 'FightBook Race Probe')`;
    await tx`INSERT INTO events (id, organization_id, slug, name, start_date, end_date)
      VALUES (${EVENT}, ${CLUB}, 'fb-race-probe', 'Race Probe', current_date, current_date)`;
    for (const who of Object.keys(F))
      await tx`INSERT INTO global_persons
          (id, slug, display_name, given_name, family_name, claimed_by_user_id, fightbook_enabled)
        VALUES (${F[who]}, ${`fb-race-${who}`}, ${who}, ${who}, 'Race', ${U[who]}, true)`;
    for (const call of [CALL, SECOND_CALL, THIRD_CALL])
      await tx`INSERT INTO spar_open_calls
          (id, poster_global_person_id, event_id, spar_day, zone, spar_time, weapons, closes_at)
        VALUES (${call}, ${F.julie}, ${EVENT}, current_date, 'Europe/Paris', '23:00',
          ARRAY['Longsword'], now() + interval '1 hour')`;
    await tx`INSERT INTO spar_open_call_answers (call_id, answerer_global_person_id)
      VALUES (${CALL}, ${F.marc}), (${CALL}, ${F.paul}), (${SECOND_CALL}, ${F.paul}),
        (${THIRD_CALL}, ${F.marc})`;
    await tx`INSERT INTO fightbook_blocks (blocker_global_person_id, blocked_global_person_id)
      VALUES (${F.lea}, ${F.paul})`;
  });
}

/** The profiles take their requests, calls, answers, codes and blocks by cascade; the club its Event. */
async function fixtureDeleted() {
  await watch.begin(async (tx) => {
    await tx`DELETE FROM global_persons WHERE id IN ${tx(Object.values(F))}`;
    await tx`DELETE FROM organizations WHERE id = ${CLUB}`;
    await tx`DELETE FROM auth.users WHERE id IN ${tx(Object.values(U))}`;
  });
}

async function nothingLeft() {
  const [row] = await watch`SELECT
      (SELECT count(*) FROM global_persons WHERE id IN ${watch(Object.values(F))})
    + (SELECT count(*) FROM organizations WHERE id = ${CLUB})
    + (SELECT count(*) FROM auth.users WHERE id IN ${watch(Object.values(U))}) AS n`;
  check('no fixture row left', Number(row.n), 0);
}

// ── Calls, as the service role (the API's client) ───────────────────────────
const HOURS_6 = () => new Date(Date.now() + 6 * 3_600_000).toISOString();

const pick = (q, answerer, call = CALL) =>
  q`SELECT public.fightbook_call_pick(${call}, ${F.julie}, ${answerer}, ${HOURS_6()}::timestamptz) AS r`.then(
    (rows) => rows[0].r,
  );

/** A free-date scan at "Salle", or with `atEvent` an Event scan at the fixture's Event. */
const scan = (q, hash, scanner, atEvent = false) =>
  q`SELECT public.fightbook_qr_log(${hash}, ${scanner}, ${atEvent ? 'event' : 'free'},
      ${atEvent ? EVENT : null}, current_date, 'Europe/Paris', ${atEvent ? null : 'Salle'},
      ARRAY['Longsword'], ${HOURS_6()}::timestamptz) AS r`.then((rows) => rows[0].r);

const codeLeft = async (hash) =>
  (await watch`SELECT count(*)::int AS n FROM fightbook_qr_codes WHERE token_hash = ${hash}`)[0].n;

async function showCode(shower) {
  const hash = createHash('sha256').update(randomBytes(16)).digest('hex');
  await watch`INSERT INTO fightbook_qr_codes (token_hash, global_person_id, expires_at)
    VALUES (${hash}, ${shower}, now() + interval '5 minutes')`;
  return hash;
}

/** A call's outcome: its value, or the word it raised. */
const settle = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ refused: error.message }),
  );

// ── The overlap ─────────────────────────────────────────────────────────────
/** Polls until B's backend is blocked by A's, for up to 5 s; true when it was. */
async function blockedBy(bPid, aPid) {
  for (let waited = 0; waited < 5_000; waited += 25) {
    const [row] = await watch`SELECT ${aPid}::int = ANY(pg_blocking_pids(${bPid}::int)) AS blocked`;
    if (row.blocked) return true;
    await delay(25);
  }
  return false;
}

const pidOf = async (q) => (await q`SELECT pg_backend_pid() AS pid`)[0].pid;

/** `call` on `conn` in a transaction of its own as the service role, its outcome settled. */
const asApi = (conn, call) =>
  settle(
    conn.begin(async (tx) => {
      await tx`SET LOCAL ROLE service_role`;
      return call(tx);
    }),
  );

/**
 * B makes `second`, which must be blocked by `holderPid` and still unanswered WAIT_MS after it
 * started. Returns B's outcome (a promise) and whether it waited.
 */
async function bWaitsOn(holderPid, second) {
  const bPid = await pidOf(connB);
  let answered = false;
  const started = Date.now();
  const b = asApi(connB, second);
  void b.then(() => {
    answered = true;
  });
  const blocked = await blockedBy(bPid, holderPid);
  await delay(Math.max(0, WAIT_MS - (Date.now() - started)));
  return { b, waited: blocked && !answered && (await blockedBy(bPid, holderPid)) };
}

/** A makes `first` in a transaction it keeps open until B is seen waiting on it; then A commits. */
async function race(first, second) {
  let a;
  let pending;
  await connA.begin(async (tx) => {
    await tx`SET LOCAL ROLE service_role`;
    const aPid = await pidOf(tx);
    a = await settle(first(tx));
    pending = await bWaitsOn(aPid, second);
  });
  return { a, b: await pending.b, waited: pending.waited };
}

async function twoPicks() {
  const { a, b, waited } = await race(
    (tx) => pick(tx, F.marc),
    (sp) => pick(sp, F.paul),
  );
  check('two picks: the second waits on the first', waited, true);
  check('two picks: the first agrees a spar', typeof a.value, 'string');
  check('two picks: the second', b, { refused: 'not_open' });
  const [row] = await watch`SELECT c.picked_global_person_id AS picked,
      (SELECT count(*)::int FROM spar_requests r
        WHERE r.asker_global_person_id = ${F.julie} AND r.status = 'agreed') AS spars
    FROM spar_open_calls c WHERE c.id = ${CALL}`;
  check('two picks: one spar, with the first answerer', [row.picked, row.spars], [F.marc, 1]);
}

const requestsTo = async (shower) =>
  (
    await watch`SELECT asker_global_person_id AS asker FROM spar_requests
      WHERE receiver_global_person_id = ${shower} AND status = 'pending' ORDER BY asker`
  ).map((r) => r.asker);

async function twoScans() {
  const hash = await showCode(F.paul);
  const { a, b, waited } = await race(
    (tx) => scan(tx, hash, F.julie),
    (sp) => scan(sp, hash, F.marc),
  );
  check('two scans: the second waits on the first', waited, true);
  check('two scans: the first asks', a.value?.notify, true);
  check('two scans: the second', b, { refused: 'bad_code' });
  check('two scans: one request', await requestsTo(F.paul), [F.julie]);
}

/**
 * A refusal cannot be held open: Postgres aborts a transaction at the error, releasing its locks,
 * not at the client's ROLLBACK. So the gate holds Lea's profile FOR UPDATE: A claims the code,
 * then stops at its pair lock's KEY SHARE on Lea, its claim held. B is seen waiting on A's claim;
 * the gate lets go; A refuses (Lea blocked Paul) and its claim is undone; B then goes through.
 */
async function refusedThenScan() {
  const hash = await showCode(F.paul);
  const aPid = await pidOf(connA);
  let a;
  let held = false;
  let pending;
  await gate.begin(async (tx) => {
    const gatePid = await pidOf(tx);
    await tx`SELECT 1 FROM global_persons WHERE id = ${F.lea} FOR UPDATE`;
    a = asApi(connA, (sp) => scan(sp, hash, F.lea));
    held = await blockedBy(aPid, gatePid);
    pending = await bWaitsOn(aPid, (sp) => scan(sp, hash, F.marc));
  });
  check('a refused scan: the first claims the code and stops at its pair lock', held, true);
  check('a refused scan: the second waits on the claim', pending.waited, true);
  check('a refused scan: the first', await a, { refused: 'you_blocked' });
  const b = await pending.b;
  check(
    'a refused scan: the second goes through with the same code, and burns it',
    [b.value?.notify, await codeLeft(hash), await requestsTo(F.paul)],
    [true, 0, [F.julie, F.marc].sort()],
  );
}

/** Decision 10: the pick holds the answer FOR SHARE, so a take-back during it waits, then lands. */
async function takeBackDuringPick() {
  const { a, b, waited } = await race(
    (tx) => pick(tx, F.marc, THIRD_CALL),
    (sp) =>
      sp`DELETE FROM spar_open_call_answers
          WHERE call_id = ${THIRD_CALL} AND answerer_global_person_id = ${F.marc}`.then(
        (result) => result.count,
      ),
  );
  check('a take-back during a pick: it waits on the pick', waited, true);
  const [row] = await watch`SELECT r.status FROM spar_open_calls c
      JOIN spar_requests r ON r.id = c.spar_request_id WHERE c.id = ${THIRD_CALL}`;
  check(
    'a take-back during a pick: the pick agrees its spar',
    [typeof a.value, row?.status],
    ['string', 'agreed'],
  );
  check('a take-back during a pick: it then takes the answer back', b, { value: 1 });
}

const committedKit = () => ({
  check,
  watch,
  scanCommitted: (hash, scanner, atEvent) => asApi(connA, (tx) => scan(tx, hash, scanner, atEvent)),
  showCode,
  codeLeft,
  F,
  EVENT,
});

const block = (q, blocker, blocked) => q`SELECT public.fightbook_block(${blocker}, ${blocked})`;

/** Julie blocks Paul while she picks him on her second call: the pick waits, then sees the block. */
async function pickAgainstBlock() {
  const { b, waited } = await race(
    (tx) => block(tx, F.julie, F.paul),
    (sp) => pick(sp, F.paul, SECOND_CALL),
  );
  check('a pick during a block: it waits on the pair lock', waited, true);
  check('a pick during a block', b, { refused: 'not_open' });
}

/** Marc blocks Paul while he scans Paul's code: the scan waits, then sees the block. */
async function scanAgainstBlock() {
  const hash = await showCode(F.paul);
  const { b, waited } = await race(
    (tx) => block(tx, F.marc, F.paul),
    (sp) => scan(sp, hash, F.marc),
  );
  check('a scan during a block: it waits on the pair lock', waited, true);
  check(
    'a scan during a block, and the code it leaves',
    [b, await codeLeft(hash)],
    [{ refused: 'you_blocked' }, 1],
  );
}

try {
  await seedCommitted();
  try {
    await twoPicks();
    await takeBackDuringPick();
    await twoScans();
    await refusedThenScan();
    await refusedScansLeaveTheCode(committedKit());
    await pickAgainstBlock();
    await scanAgainstBlock();
  } finally {
    await fixtureDeleted();
  }
  await nothingLeft();
  if (checks !== EXPECTED_CHECKS)
    failures.push(
      `ran ${checks} checks, declares ${EXPECTED_CHECKS}: a race stopped early or grew`,
    );
  if (failures.length > 0) {
    console.error(
      `FightBook race probe FAILED (${failures.length}):\n  - ${failures.join('\n  - ')}`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `FightBook race probe passed: ${checks} checks; two picks of one call make one spar, two scans of one code make one request, a scan refused after its claim leaves the code to the scan waiting on it, a refused scan leaves its code, a take-back during a pick waits, and a pick or a scan waiting on a block sees it.`,
    );
  }
} catch (error) {
  console.error(`FightBook race probe could not run: ${error.message}`);
  process.exitCode = 1;
} finally {
  await Promise.all([connA.end(), connB.end(), watch.end(), gate.end()]);
}
