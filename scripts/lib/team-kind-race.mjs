/**
 * The race of the kind trigger (migration 0281, "THE RACE"): an entrant and a change of its
 * Tournament's kind AT ONCE, on two connections, on COMMITTED rows. Run by the cascade probe
 * (`db-cascade-probe.mjs`), which commits its seed on a disposable replay: the RLS probe runs in
 * one transaction it rolls back, so a second connection there would see none of its rows.
 *
 * How the overlap is made CERTAIN, never by repetition (as `db-fightbook-race-probe.mjs`):
 * connection A opens a transaction, writes, and does not end it. Connection B writes. The probe
 * then reads, from the probe's own connection, that B's backend is blocked by A's
 * (`pg_blocking_pids`) and that B has not answered 500 ms after it started. Only then does A
 * commit, and B's answer is checked. Both write as the service role, the API's client.
 *
 * The races, each on a team Tournament with no entrant, made for it under the seed's Event:
 *   - a team added while the kind changes: A changes the kind to 'individual'; B's insert waits in
 *     its trigger's FOR SHARE read of the Tournament, then reads the kind of after A and is
 *     refused (`entrant_kind_holds:`);
 *   - a change of kind while a team is added: A adds a team and holds its FOR SHARE; B's change
 *     waits on it, then its AFTER check sees A's team and is refused (`entrant_kind_is_settled:`).
 * The Tournaments stay committed and go with the seed's Event, by the probe's club delete.
 */
import { setTimeout as delay } from 'node:timers/promises';

import postgres from 'postgres';

const WAIT_MS = 500;

/** A call's outcome: its value, or the message and SQLSTATE it raised. */
const settle = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ refused: error.message, code: error.code }),
  );

const pidOf = async (q) => (await q`SELECT pg_backend_pid() AS pid`)[0].pid;

/** Polls until B's backend is blocked by A's, for up to 5 s; true when it was. */
async function blockedBy(watch, bPid, aPid) {
  for (let waited = 0; waited < 5_000; waited += 25) {
    const [row] = await watch`SELECT ${aPid}::int = ANY(pg_blocking_pids(${bPid}::int)) AS blocked`;
    if (row.blocked) return true;
    await delay(25);
  }
  return false;
}

/**
 * A makes `first` in a transaction it keeps open until B, making `second`, is seen waiting on it
 * and still unanswered WAIT_MS after it started; then A commits. B's outcome, and whether it waited.
 */
async function race({ watch, connA, connB }, first, second) {
  const bPid = await pidOf(connB);
  let b;
  let waited = false;
  await connA.begin(async (tx) => {
    await tx`SET LOCAL ROLE service_role`;
    const aPid = await pidOf(tx);
    await first(tx);
    let answered = false;
    const started = Date.now();
    b = settle(
      connB.begin(async (sp) => {
        await sp`SET LOCAL ROLE service_role`;
        return second(sp);
      }),
    );
    void b.then(() => {
      answered = true;
    });
    const blocked = await blockedBy(watch, bPid, aPid);
    await delay(Math.max(0, WAIT_MS - (Date.now() - started)));
    waited = blocked && !answered && (await blockedBy(watch, bPid, aPid));
  });
  return { b: await b, waited };
}

/** A committed team Tournament of `event` with no entrant; its id. */
async function emptyTeamTournament(watch, event, slug) {
  const [{ id }] = await watch`INSERT INTO tournaments (event_id, slug, name, status, entrant_kind)
                               VALUES (${event}, ${slug}, ${slug}, 'draft', 'team') RETURNING id`;
  return id;
}

const addTeam = (q, tournament, slug) =>
  q`INSERT INTO teams (tournament_id, name, slug, size) VALUES (${tournament}, ${slug}, ${slug}, 3)`;

const makeIndividual = (q, tournament) =>
  q`UPDATE tournaments SET entrant_kind = 'individual' WHERE id = ${tournament}`;

/** The Tournament's kind and its number of teams, as committed. */
async function stateOf(watch, tournament) {
  const [row] = await watch`SELECT t.entrant_kind AS kind,
      (SELECT count(*)::int FROM teams tm WHERE tm.tournament_id = t.id) AS teams
    FROM tournaments t WHERE t.id = ${tournament}`;
  return [row.kind, row.teams];
}

/**
 * Refused as the API's `entrantKindRefusal` reads it (`apps/api/src/common/entrant-kind-refusal.ts`):
 * SQLSTATE 23514 and the message starting with the trigger's prefix. PostgREST passes both on.
 */
const refusedWith = (outcome, prefix) =>
  outcome?.code === '23514' && outcome.refused?.startsWith(prefix) === true;

/**
 * The two races: what A does and keeps open, what B does, the prefix B must be refused with, and
 * the Tournament's kind and number of teams once both ended.
 */
const RACES = [
  {
    what: 'a team during a change of kind',
    slug: 'kind-race-changed',
    first: (tx, id) => makeIndividual(tx, id),
    second: (sp, id) => addTeam(sp, id, 'late-team'),
    refusedWith: 'entrant_kind_holds:',
    after: ['individual', 0],
  },
  {
    what: 'a change of kind during a team',
    slug: 'kind-race-added',
    first: (tx, id) => addTeam(tx, id, 'early-team'),
    second: (sp, id) => makeIndividual(sp, id),
    refusedWith: 'entrant_kind_is_settled:',
    after: ['team', 1],
  },
];

/** One race of `RACES` on a new empty team Tournament of `event`: three checks. */
async function oneRace(conns, { check, event }, spec) {
  const id = await emptyTeamTournament(conns.watch, event, spec.slug);
  const { b, waited } = await race(
    conns,
    (tx) => spec.first(tx, id),
    (sp) => spec.second(sp, id),
  );
  check(`${spec.what}: the second waits on the first`, waited, 'not blocked');
  check(
    `${spec.what}: the second is refused 23514 with ${spec.refusedWith}`,
    refusedWith(b, spec.refusedWith),
    JSON.stringify(b),
  );
  const after = await stateOf(conns.watch, id);
  check(
    `${spec.what}: the Tournament's kind and teams after`,
    JSON.stringify(after) === JSON.stringify(spec.after),
    `${JSON.stringify(after)}, not ${JSON.stringify(spec.after)}`,
  );
}

/** Both races; each check counted by the caller's `check(label, ok, detail)`. */
export async function teamKindRaces({ databaseUrl, watch, check, event }) {
  const options = { max: 1, onnotice: () => {}, connection: { statement_timeout: 30_000 } };
  const conns = {
    watch,
    connA: postgres(databaseUrl, options),
    connB: postgres(databaseUrl, options),
  };
  try {
    for (const spec of RACES) await oneRace(conns, { check, event }, spec);
  } finally {
    await Promise.all([conns.connA.end(), conns.connB.end()]);
  }
}
