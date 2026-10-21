/**
 * The cascade probe (migration 0237, operator rulings 91 and 92): an Event, a Tournament, a phase
 * and a club delete on COMMITTED rows, whatever order Postgres fires the cascade's triggers in, and
 * every refusal that protects live data still holds.
 *
 * Why it exists. A key whose child and parent both die by cascade from one ancestor was checked as
 * soon as the parent's cascade step ended, and Postgres orders those steps by trigger NAME, which
 * holds an OID as text: an Event delete with one registered Fighter failed on every database, and a
 * Tournament delete failed on some by OID order. 0237 makes those keys checked at commit.
 *
 * Why not inside the RLS probe. That probe seeds and checks in one transaction it rolls back, and
 * Postgres re-checks every key of a row written by the same transaction: a delete of rows seeded in
 * its own transaction tests something no real delete does. This one COMMITS its seed
 * (`packages/db/fixtures/cascade-probe-seed.sql`), tries each delete in a transaction of its own
 * that forces the deferred checks (`SET CONSTRAINTS ALL IMMEDIATE`) before rolling back, then
 * deletes the seed for real, by the club delete it tests.
 *
 * Run it after `pnpm db:migrations:replay`, on the same disposable database. It COMMITS rows, so
 * it runs only when told the database is disposable:
 *   CASCADE_PROBE_DISPOSABLE=1 DATABASE_URL=postgres://… pnpm db:cascade-probe
 *
 * What it checks:
 *   - no key a cascade can trip by trigger order is left: any RESTRICT key, deferrable or not
 *     (Postgres checks RESTRICT at once), and any immediate NO ACTION key, whose child and parent
 *     both die by cascade from one ancestor; and, so an empty scan cannot pass, the same search
 *     without the "immediate" filter finds exactly the nine keys of 0237;
 *   - each seeded row was written;
 *   - a delete of the Event, the Tournament, the phase and the club succeeds and takes the bouts;
 *   - a delete of a registration a bout names, a person with a registration, the copy a bout holds,
 *     a referee skill slots list and a compensation plan an Event uses is refused (23503) by one of
 *     the keys that protect it;
 *   - the club delete commits, and leaves none of the seeded rows.
 * Each check counts itself; the probe fails when any fails, and when fewer ran than it declares.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error(
    'DATABASE_URL is required and must point at a disposable, freshly replayed database (pnpm db:migrations:replay).',
  );
  process.exit(1);
}
if (process.env['CASCADE_PROBE_DISPOSABLE'] !== '1') {
  console.error(
    'The cascade probe commits rows: set CASCADE_PROBE_DISPOSABLE=1 to say DATABASE_URL names a disposable replay.',
  );
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
const seedPath = fileURLToPath(
  new URL('../packages/db/fixtures/cascade-probe-seed.sql', import.meta.url),
);
const EXPECTED_CHECKS = 47;
const ROLLBACK = new Error('rollback');

const CLUB = 'ca5c0000-0000-4000-8000-000000000001';
const EVENT = 'ca5c0000-0000-4000-8000-0000000000e1';
const TOURNAMENT = 'ca5c0000-0000-4000-8000-0000000000f1';
const PHASE = 'ca5c0000-0000-4000-8000-0000000000b1';
const COPY = 'ca5c0000-0000-4000-8000-0000000000d1';
const RED_PERSON = 'ca5c0000-0000-4000-8000-000000000101';
const RED = 'ca5c0000-0000-4000-8000-000000000201';
const BOUT = 'ca5c0000-0000-4000-8000-000000000301';
const REFEREE = 'ca5c0000-0000-4000-8000-000000000701';
const SKILL = 'cascade-probe-skill';
const PLAN = 'ca5c0000-0000-4000-8000-000000000a01';

/** The nine keys 0237 made deferred. */
const DEFERRED_KEYS = [
  'event_slot_config_default_skills_skill_id_fkey',
  'match_forfeits_forfeiting_registration_id_fkey',
  'match_forfeits_winner_registration_id_fkey',
  'matches_blue_registration_id_fkey',
  'matches_match_rules_id_fkey',
  'matches_red_registration_id_fkey',
  'referee_compensation_event_settings_plan_id_fkey',
  'registrations_person_id_fkey',
  'tournament_slot_allowed_skills_skill_id_fkey',
];

/** Every seeded row, by table and key: what must exist after the seed and be gone at the end. */
const SEEDED = [
  ['organizations', 'id', CLUB],
  ['events', 'id', EVENT],
  ['lices', 'id', 'ca5c0000-0000-4000-8000-0000000000a1'],
  ['tournaments', 'id', TOURNAMENT],
  ['phases', 'id', PHASE],
  ['pools', 'id', 'ca5c0000-0000-4000-8000-0000000000c1'],
  ['match_rules', 'id', COPY],
  ['persons', 'id', RED_PERSON],
  ['persons', 'id', 'ca5c0000-0000-4000-8000-000000000102'],
  ['registrations', 'id', RED],
  ['registrations', 'id', 'ca5c0000-0000-4000-8000-000000000202'],
  ['matches', 'id', BOUT],
  ['matches', 'id', 'ca5c0000-0000-4000-8000-000000000302'],
  ['exchanges', 'id', 'ca5c0000-0000-4000-8000-000000000401'],
  ['match_penalties', 'id', 'ca5c0000-0000-4000-8000-000000000501'],
  ['match_forfeits', 'id', 'ca5c0000-0000-4000-8000-000000000601'],
  ['global_persons', 'id', REFEREE],
  ['referee_assignments', 'id', 'ca5c0000-0000-4000-8000-000000000801'],
  ['referee_skills', 'id', SKILL],
  ['tournament_slot_config', 'id', 'ca5c0000-0000-4000-8000-000000000901'],
  ['tournament_slot_allowed_skills', 'skill_id', SKILL],
  ['event_slot_config_default', 'id', 'ca5c0000-0000-4000-8000-000000000902'],
  ['event_slot_config_default_skills', 'skill_id', SKILL],
  ['referee_compensation_plans', 'id', PLAN],
  ['referee_compensation_event_settings', 'plan_id', PLAN],
];

let checks = 0;
const failures = [];
function check(label, ok, detail) {
  checks += 1;
  if (!ok) failures.push(`${label}: ${detail}`);
}

/**
 * The keys a cascade can trip by trigger order: child and parent both reached by a cascade from
 * one ancestor. `immediateOnly` false drops the timing filter (the positive control).
 */
async function trippableKeys(immediateOnly) {
  const rows = await sql`
    WITH RECURSIVE fk AS (
      SELECT c.conname, c.conrelid AS child, c.confrelid AS parent, c.confdeltype, c.condeferred
        FROM pg_constraint c
       WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
    ),
    reach (anc, tbl) AS (
      SELECT DISTINCT parent, parent FROM fk
      UNION
      SELECT r.anc, f.child FROM reach r JOIN fk f ON f.parent = r.tbl AND f.confdeltype = 'c'
    )
    SELECT DISTINCT f.conname
      FROM fk f
      JOIN reach rp ON rp.tbl = f.parent AND rp.anc <> f.parent
      JOIN reach rc ON rc.tbl = f.child AND rc.anc = rp.anc
     WHERE f.confdeltype = 'r'
        OR (f.confdeltype = 'a' AND (NOT f.condeferred OR NOT ${immediateOnly}))
     ORDER BY f.conname`;
  return rows.map((row) => row.conname);
}

async function noKeyTrippableByOrder() {
  const left = await trippableKeys(true);
  check('keys a cascade can trip by order', left.length === 0, left.join(', '));
  const all = await trippableKeys(false);
  check(
    'the search finds the nine keys of 0237 without its timing filter',
    JSON.stringify(all) === JSON.stringify(DEFERRED_KEYS),
    `found ${all.join(', ') || 'none'}`,
  );
}

async function rowExists(q, [table, column, id]) {
  const [row] =
    await q`SELECT count(*)::int AS n FROM ${q(table)} WHERE ${q(column)}::text = ${id}`;
  return row.n > 0;
}

/**
 * `statement` in a transaction of its own, the deferred checks forced in it, then rolled back.
 * Its error, or null; `after(tx)` reads the state before the rollback.
 */
async function tryAndRollBack(statement, after = async () => {}) {
  let observed;
  try {
    await sql.begin(async (tx) => {
      await statement(tx);
      await tx`SET CONSTRAINTS ALL IMMEDIATE`;
      observed = await after(tx);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) return { error, observed };
  }
  return { error: null, observed };
}

async function deletesSucceed() {
  const cases = [
    ['the Event', (tx) => tx`DELETE FROM events WHERE id = ${EVENT}`],
    ['the Tournament', (tx) => tx`DELETE FROM tournaments WHERE id = ${TOURNAMENT}`],
    ['the phase', (tx) => tx`DELETE FROM phases WHERE id = ${PHASE}`],
    ['the club', (tx) => tx`DELETE FROM organizations WHERE id = ${CLUB}`],
  ];
  for (const [what, statement] of cases) {
    const { error, observed } = await tryAndRollBack(statement, (tx) =>
      rowExists(tx, ['matches', 'id', BOUT]),
    );
    check(`delete of ${what}`, error === null, error?.message ?? '');
    check(`delete of ${what} took the bout`, error !== null || observed === false, 'bout left');
  }
}

async function refusalsHold() {
  const cases = [
    [
      'a registration a bout names',
      (tx) => tx`DELETE FROM registrations WHERE id = ${RED}`,
      [
        'matches_red_registration_id_fkey',
        'matches_blue_registration_id_fkey',
        'match_forfeits_winner_registration_id_fkey',
        'match_forfeits_forfeiting_registration_id_fkey',
      ],
    ],
    [
      'a person with a registration',
      (tx) => tx`DELETE FROM persons WHERE id = ${RED_PERSON}`,
      ['registrations_person_id_fkey'],
    ],
    [
      'the copy a bout holds',
      (tx) => tx`DELETE FROM match_rules WHERE id = ${COPY}`,
      ['matches_match_rules_id_fkey'],
    ],
    [
      'a referee skill slots list',
      (tx) => tx`DELETE FROM referee_skills WHERE id = ${SKILL}`,
      [
        'tournament_slot_allowed_skills_skill_id_fkey',
        'event_slot_config_default_skills_skill_id_fkey',
      ],
    ],
    [
      'a plan an Event uses',
      (tx) => tx`DELETE FROM referee_compensation_plans WHERE id = ${PLAN}`,
      ['referee_compensation_event_settings_plan_id_fkey'],
    ],
  ];
  for (const [what, statement, keys] of cases) {
    const { error } = await tryAndRollBack(statement);
    check(`delete of ${what} refused`, error?.code === '23503', error?.message ?? 'accepted');
    check(
      `delete of ${what} refused by its key`,
      keys.includes(error?.constraint_name),
      `refused by ${error?.constraint_name ?? 'nothing'}`,
    );
  }
}

async function seedCommitted() {
  if (await rowExists(sql, ['organizations', 'id', CLUB]))
    throw new Error(
      `the seed's club ${CLUB} is already there: a run before left it; replay a fresh database`,
    );
  await sql.begin((tx) => tx.unsafe(readFileSync(seedPath, 'utf8')));
  for (const row of SEEDED) check(`seeded ${row.join(' ')}`, await rowExists(sql, row), 'missing');
}

/**
 * The club delete for real, committed; then the referee's profile, which is no club's. When the
 * club delete is refused (the red this probe exists for), the seed still goes: the bouts and
 * registrations first, by hand, so the next run tests again instead of finding a leftover.
 */
async function seedDeleted() {
  const referee = (tx) => tx`DELETE FROM global_persons WHERE id = ${REFEREE}`;
  try {
    const { count } = await sql.begin(async (tx) => {
      const deleted = await tx`DELETE FROM organizations WHERE id = ${CLUB}`;
      await referee(tx);
      return deleted;
    });
    check('the club delete committed', count === 1, `deleted ${count} clubs`);
  } catch (error) {
    check('the club delete committed', false, error.message);
    await sql.begin(async (tx) => {
      await tx`DELETE FROM match_forfeits WHERE tournament_id = ${TOURNAMENT}`;
      await tx`DELETE FROM matches WHERE phase_id = ${PHASE}`;
      await tx`DELETE FROM registrations WHERE tournament_id = ${TOURNAMENT}`;
      await tx`DELETE FROM tournament_slot_allowed_skills WHERE skill_id = ${SKILL}`;
      await tx`DELETE FROM event_slot_config_default_skills WHERE skill_id = ${SKILL}`;
      await tx`DELETE FROM referee_compensation_event_settings WHERE plan_id = ${PLAN}`;
      await tx`DELETE FROM organizations WHERE id = ${CLUB}`;
      await referee(tx);
    });
  }
}

async function nothingLeft() {
  const left = [];
  for (const row of SEEDED) if (await rowExists(sql, row)) left.push(row.join(' '));
  check('no seeded row left', left.length === 0, left.join('; '));
}

try {
  await noKeyTrippableByOrder();
  await seedCommitted();
  try {
    await deletesSucceed();
    await refusalsHold();
  } finally {
    await seedDeleted();
  }
  await nothingLeft();
  if (checks !== EXPECTED_CHECKS)
    failures.push(
      `ran ${checks} checks, declares ${EXPECTED_CHECKS}: a case stopped early or grew`,
    );
  if (failures.length > 0) {
    console.error(`Cascade probe FAILED (${failures.length}):\n  - ${failures.join('\n  - ')}`);
    process.exitCode = 1;
  } else {
    console.log(
      `Cascade probe passed: ${checks} checks; an Event, a Tournament, a phase and a club delete on committed rows, every refusal that protects live data holds.`,
    );
  }
} catch (error) {
  console.error(`Cascade probe could not run: ${error.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
