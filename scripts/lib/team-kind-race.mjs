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
 * The races, each on a Tournament with no entrant and no phase, made for it under the seed's Event:
 * a team one for the kind trigger (0281), an individual one for the League link (0287) and for the
 * phase (0288):
 *   - a team added while the kind changes: A changes the kind to 'individual'; B's insert waits in
 *     its trigger's FOR SHARE read of the Tournament, then reads the kind of after A and is
 *     refused (`entrant_kind_holds:`);
 *   - a change of kind while a team is added: A adds a team and holds its FOR SHARE; B's change
 *     waits on it, then its AFTER check sees A's team and is refused (`entrant_kind_is_settled:`);
 *   - a League link requested while the kind changes: A switches the Tournament to 'team'; B's link
 *     waits in its trigger's FOR SHARE read, then reads 'team' and is refused
 *     (`league_link_individual_only:`);
 *   - a switch to 'team' while a link is requested: A requests the link and holds its FOR SHARE;
 *     B's switch waits on it, then its AFTER check sees A's link and is refused
 *     (`league_link_blocks_team:`);
 *   - a switch to 'team' while a phase is added (0288, ruling 983): A adds a bracket phase and holds
 *     its FOR SHARE (`phase_locks_entrant_kind`); B's switch waits on it, then its AFTER check sees
 *     A's phase and is refused (`entrant_kind_set_before_phases:`). The phase's foreign key alone
 *     takes FOR KEY SHARE, which a switch does not block: without the lock B would not wait, would
 *     not see the phase, and would be taken.
 * The Tournaments stay committed and go with the seed's Event, by the probe's club delete; the
 * League the link races make is deleted at the end, and its links with it.
 */
import { setTimeout as delay } from 'node:timers/promises';

import postgres from 'postgres';

const WAIT_MS = 500;
// Who requested the race's League links: any id, the column has no foreign key (0015).
const REQUESTER = '11111111-1111-4111-8111-111111111111';

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

/** A committed Tournament of `event` of `kind`, with no entrant; its id. */
async function emptyTournament(watch, event, slug, kind) {
  const [{ id }] = await watch`INSERT INTO tournaments (event_id, slug, name, status, entrant_kind)
                               VALUES (${event}, ${slug}, ${slug}, 'draft', ${kind}) RETURNING id`;
  return id;
}

/**
 * A committed League for the link races; its id. A League belongs to no club or Event
 * (`requested_by_user_id` on its links is NOT NULL with no foreign key, 0015), so the caller deletes it.
 */
async function raceLeague(watch) {
  const [{ id }] = await watch`INSERT INTO leagues (slug, name, season_year)
                               VALUES ('kind-race-league', 'Kind race league', 2026) RETURNING id`;
  return id;
}

const addTeam = (q, tournament, slug) =>
  q`INSERT INTO teams (tournament_id, name, slug, size) VALUES (${tournament}, ${slug}, ${slug}, 3)`;

const makeIndividual = (q, tournament) =>
  q`UPDATE tournaments SET entrant_kind = 'individual' WHERE id = ${tournament}`;

const makeTeam = (q, tournament) =>
  q`UPDATE tournaments SET entrant_kind = 'team' WHERE id = ${tournament}`;

const requestLink = (q, tournament, league) =>
  q`INSERT INTO league_tournament_links (league_id, tournament_id, status, requested_by_user_id)
    VALUES (${league}, ${tournament}, 'requested', ${REQUESTER})`;

const addPhase = (q, tournament) =>
  q`INSERT INTO phases (tournament_id, type) VALUES (${tournament}, 'single_elim')`;

/**
 * The Tournament's kind, its number of teams, its number of live League links and its number of
 * phases, as committed.
 */
async function stateOf(watch, tournament) {
  const [row] = await watch`SELECT t.entrant_kind AS kind,
      (SELECT count(*)::int FROM teams tm WHERE tm.tournament_id = t.id) AS teams,
      (SELECT count(*)::int FROM league_tournament_links l
        WHERE l.tournament_id = t.id AND l.status IN ('requested', 'approved')) AS links,
      (SELECT count(*)::int FROM phases p WHERE p.tournament_id = t.id) AS phases
    FROM tournaments t WHERE t.id = ${tournament}`;
  return [row.kind, row.teams, row.links, row.phases];
}

/**
 * Refused as the API's `entrantKindRefusal` reads it (`apps/api/src/common/entrant-kind-refusal.ts`):
 * SQLSTATE 23514 and the message starting with the trigger's prefix. PostgREST passes both on.
 */
const refusedWith = (outcome, prefix) =>
  outcome?.code === '23514' && outcome.refused?.startsWith(prefix) === true;

/**
 * The five races: the kind the empty Tournament starts with, what A does and keeps open, what B
 * does, the prefix B must be refused with, and the Tournament's kind, number of teams, number of
 * live League links and number of phases once both ended. `league` is the race League's id.
 */
const RACES = [
  {
    what: 'a team during a change of kind',
    slug: 'kind-race-changed',
    kind: 'team',
    first: (tx, id) => makeIndividual(tx, id),
    second: (sp, id) => addTeam(sp, id, 'late-team'),
    refusedWith: 'entrant_kind_holds:',
    after: ['individual', 0, 0, 0],
  },
  {
    what: 'a change of kind during a team',
    slug: 'kind-race-added',
    kind: 'team',
    first: (tx, id) => addTeam(tx, id, 'early-team'),
    second: (sp, id) => makeIndividual(sp, id),
    refusedWith: 'entrant_kind_is_settled:',
    after: ['team', 1, 0, 0],
  },
  {
    what: 'a League link during a switch to team',
    slug: 'kind-race-switched',
    kind: 'individual',
    first: (tx, id) => makeTeam(tx, id),
    second: (sp, id, league) => requestLink(sp, id, league),
    refusedWith: 'league_link_individual_only:',
    after: ['team', 0, 0, 0],
  },
  {
    what: 'a switch to team during a League link',
    slug: 'kind-race-linked',
    kind: 'individual',
    first: (tx, id, league) => requestLink(tx, id, league),
    second: (sp, id) => makeTeam(sp, id),
    refusedWith: 'league_link_blocks_team:',
    after: ['individual', 0, 1, 0],
  },
  {
    what: 'a switch to team during a phase',
    slug: 'kind-race-phased',
    kind: 'individual',
    first: (tx, id) => addPhase(tx, id),
    second: (sp, id) => makeTeam(sp, id),
    refusedWith: 'entrant_kind_set_before_phases:',
    after: ['individual', 0, 0, 1],
  },
];

/** One race of `RACES` on a new empty Tournament of `event`: three checks. */
async function oneRace(conns, { check, event, league }, spec) {
  const id = await emptyTournament(conns.watch, event, spec.slug, spec.kind);
  const { b, waited } = await race(
    conns,
    (tx) => spec.first(tx, id, league),
    (sp) => spec.second(sp, id, league),
  );
  check(`${spec.what}: the second waits on the first`, waited, 'not blocked');
  check(
    `${spec.what}: the second is refused 23514 with ${spec.refusedWith}`,
    refusedWith(b, spec.refusedWith),
    JSON.stringify(b),
  );
  const after = await stateOf(conns.watch, id);
  check(
    `${spec.what}: the Tournament's kind, teams, live League links and phases after`,
    JSON.stringify(after) === JSON.stringify(spec.after),
    `${JSON.stringify(after)}, not ${JSON.stringify(spec.after)}`,
  );
}

/** Every race; each check counted by the caller's `check(label, ok, detail)`. */
export async function teamKindRaces({ databaseUrl, watch, check, event }) {
  const options = { max: 1, onnotice: () => {}, connection: { statement_timeout: 30_000 } };
  const conns = {
    watch,
    connA: postgres(databaseUrl, options),
    connB: postgres(databaseUrl, options),
  };
  const league = await raceLeague(watch);
  try {
    for (const spec of RACES) await oneRace(conns, { check, event, league }, spec);
  } finally {
    await watch`DELETE FROM leagues WHERE id = ${league}`;
    await Promise.all([conns.connA.end(), conns.connB.end()]);
  }
}
