/**
 * Check 10 of the RLS probe (`scripts/db-rls-probe.mjs`): a Tournament written through PostgREST
 * names only a ruleset its organisation is offered, and a ruleset code has one row (migration 0224,
 * operator rulings "Pair through the DB", "One tag", "Platform draft", "Exempt list").
 *
 * An organisation admin may write `tournaments` under `tournaments_write`. Signed in, they may name
 * a built-in, their club's own live ruleset or a shared live one; never another club's private
 * ruleset, nor an archived one or a draft, the platform's included, nor a club row marked
 * `is_system`; and no ruleset row, even one the API writes, may take a code another owner holds
 * (a decoy, or a squatter on a built-in's code). An edit that re-sends the pair passes
 * whatever became of the ruleset since, and so does a move to another Event of the same club; a
 * Tournament or an Event moved to another organisation takes only pairs the new one is offered.
 * The service role is exempt (the API decides at its doors); a role added later is not.
 */

import { ORG_ADMIN } from './rls-probe-tables.mjs';

// The Club, its admin and its two Events, and the published Tournament of `rls-probe-seed.sql`.
const CLUB = 'aaaaaaaa-0000-4000-8000-000000000001';
const OPEN = 'eeeeeeee-0000-4000-8000-00000000000a';
const DRAFT = 'eeeeeeee-0000-4000-8000-00000000000b';
const SEEDED = '77777777-0000-4000-8000-00000000000a';
const OTHER = 'aaaaaaaa-0000-4000-8000-0000000000b2';
const MOVED = 'eeeeeeee-0000-4000-8000-0000000000b2';
const MOVABLE = 'eeeeeeee-0000-4000-8000-0000000000b3';
const ELSEWHERE = 'eeeeeeee-0000-4000-8000-0000000000b4';
// A signed-in account that is no member of the Club.
const STRANGER = '66666666-6666-4666-8666-666666666666';

const NOT_OFFERED = 'This ruleset is not available to this organisation';
const MOVE_REFUSED = 'A Tournament of this Event names a ruleset the new organisation may not use';

const RULESETS = [
  // [code, owner, shared, status, is_system]
  ['PROBE_OWN', CLUB, false, 'published', false],
  ['PROBE_OWN_DRAFT', CLUB, false, 'draft', false],
  ['PROBE_OWN_ARCHIVED', CLUB, false, 'archived', false],
  // A club may set `is_system` on a row of its own: that does not make it a built-in.
  ['PROBE_OWN_MARKED_SYSTEM', CLUB, false, 'published', true],
  ['PROBE_CLUB_SHARED', CLUB, true, 'published', false],
  ['PROBE_SHARED', OTHER, true, 'published', false],
  ['PROBE_SHARED_DRAFT', OTHER, true, 'draft', false],
  ['PROBE_PLATFORM_DRAFT', null, true, 'draft', false],
  ['PROBE_PRIVATE', OTHER, false, 'published', false],
];

// Thrown to end a savepoint on purpose: the rows inside it end with it.
const ROLLBACK = new Error('rollback');

/**
 * `statement` as `role`, signed in as `sub` (the Club's admin by default), in a savepoint always
 * rolled back: a released one would keep the role for the rest of the transaction. Its error, or
 * null.
 */
async function attempt(tx, role, statement, sub = ORG_ADMIN) {
  let failure = null;
  try {
    await tx.savepoint(async (sp) => {
      await sp`SELECT set_config('request.jwt.claims', ${JSON.stringify({ role, sub })}, true)`;
      await sp`SELECT set_config('role', ${role}, true)`;
      await statement(sp).catch((error) => {
        failure = error;
      });
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return failure;
}

const asAdmin = (tx, statement) => attempt(tx, 'authenticated', statement);

const insertWith = (code) => (sp) => sp`
  INSERT INTO tournaments (event_id, slug, name, ruleset_code, ruleset_version, status)
  VALUES (${OPEN}, ${`probe-${code.toLowerCase()}`}, 'Probe', ${code}, '1.0.0', 'draft')`;

/** Refused by 0224 itself: its error code AND its words, not a CHECK or a trigger of another rule. */
const refusedBy = (error, message) => error?.code === '23514' && error.message === message;

/**
 * A signed-in write of `tournaments` loops through the RLS helpers of its policy checks today
 * ("stack depth limit exceeded", ruling 111a leaves it latent), so the write never lands. The day
 * the loop is fixed is the day the trigger matters: the helpers run as SECURITY DEFINER here,
 * inside the savepoint, which the probe always rolls back.
 */
const LOOPING_HELPERS = [
  'is_super_admin()',
  'is_platform_staff()',
  'is_org_member(uuid)',
  'has_org_role(uuid, text)',
];

async function seedInside(sp) {
  for (const helper of LOOPING_HELPERS)
    await sp.unsafe(`ALTER FUNCTION public.${helper} SECURITY DEFINER`);
  await sp`INSERT INTO organizations (id, slug, name) VALUES (${OTHER}, 'rls-probe-other', 'Other')`;
  for (const [code, owner, shared, status, system] of RULESETS)
    await sp`
      INSERT INTO custom_rulesets
        (code, version, name, status, owner_organization_id, public_visibility, is_system)
      VALUES (${code}, '1.0.0', ${code}, ${status}, ${owner}, ${shared}, ${system})`;
}

async function writeFailures(sp, failures) {
  for (const code of ['TF_v1', 'PROBE_OWN', 'PROBE_SHARED']) {
    const error = await asAdmin(sp, insertWith(code));
    if (error) failures.push(`the Club's admin could not name ${code} (${error.message})`);
  }
  for (const code of [
    'PROBE_OWN_DRAFT',
    'PROBE_OWN_ARCHIVED',
    'PROBE_OWN_MARKED_SYSTEM',
    'PROBE_SHARED_DRAFT',
    'PROBE_PLATFORM_DRAFT',
    'PROBE_PRIVATE',
  ]) {
    const error = await asAdmin(sp, insertWith(code));
    if (!refusedBy(error, NOT_OFFERED))
      failures.push(
        `the Club's admin named ${code} (${error?.message ?? 'no error'}): 0224 did not refuse it`,
      );
  }
  const repin = await asAdmin(
    sp,
    (inner) => inner`UPDATE tournaments SET ruleset_code = 'PROBE_PRIVATE' WHERE id = ${SEEDED}`,
  );
  if (!refusedBy(repin, NOT_OFFERED))
    failures.push(`the Club's admin re-pinned to PROBE_PRIVATE (${repin?.message ?? 'no error'})`);
}

/** A row of the Club's own may not take a code another owner holds: no decoy, no squatter. */
async function codeFailures(sp, failures) {
  // As the service role: only the API writes a ruleset row (0225), and the index refuses it too.
  for (const code of ['PROBE_PRIVATE', 'TF_v1']) {
    const error = await attempt(
      sp,
      'service_role',
      (inner) => inner`
        INSERT INTO custom_rulesets (code, version, name, status, owner_organization_id)
        VALUES (${code}, '1.0.0', 'Decoy', 'published', ${CLUB})`,
    );
    if (error?.code !== '23505' || error.constraint_name !== 'custom_rulesets_code_unique_idx')
      failures.push(
        `a row of the Club's own took code ${code}, which another owner holds (${error?.message ?? 'no error'})`,
      );
  }
}

/** Only the app and a connection with no role skip the rule; a role added later is checked. */
async function exemptFailures(sp, failures) {
  const service = await attempt(sp, 'service_role', insertWith('PROBE_PRIVATE'));
  if (service) failures.push(`the service role was refused PROBE_PRIVATE (${service.message})`);
  await sp`CREATE ROLE rls_probe_new_role NOLOGIN`;
  // A new role for the web door, with the signed-in user's grants.
  await sp`GRANT authenticated TO rls_probe_new_role`;
  const added = await attempt(sp, 'rls_probe_new_role', insertWith('PROBE_PRIVATE'));
  if (!refusedBy(added, NOT_OFFERED))
    failures.push(
      `a role added later named PROBE_PRIVATE (${added?.message ?? 'no error'}): only the service role is exempt`,
    );
  // A writer RLS refuses never reaches the trigger, so it learns nothing of the rulesets it reads.
  const stranger = await attempt(sp, 'authenticated', insertWith('PROBE_PRIVATE'), STRANGER);
  if (stranger?.code !== '42501')
    failures.push(
      `a stranger to the Club got past RLS or heard the trigger (${stranger?.message ?? 'no error'})`,
    );
}

/** A pair stored before its ruleset went out of reach: what may still be written around it. */
async function storedPairFailures(sp, failures) {
  await sp`UPDATE tournaments SET ruleset_code = 'PROBE_PRIVATE' WHERE id = ${SEEDED}`;
  const rename = await asAdmin(
    sp,
    (inner) =>
      inner`UPDATE tournaments SET name = 'Renamed', ruleset_code = 'PROBE_PRIVATE' WHERE id = ${SEEDED}`,
  );
  if (rename)
    failures.push(`an edit that re-sends the stored pair was refused (${rename.message})`);
  const version = await asAdmin(
    sp,
    (inner) => inner`UPDATE tournaments SET ruleset_version = '1.0.1' WHERE id = ${SEEDED}`,
  );
  if (!refusedBy(version, NOT_OFFERED))
    failures.push(
      `a version move kept another club's private ruleset (${version?.message ?? 'no error'})`,
    );
  const [{ id: archived }] = await sp`
    INSERT INTO tournaments (event_id, slug, name, ruleset_code, ruleset_version)
    VALUES (${OPEN}, 'probe-archived-move', 'Archived', 'PROBE_OWN_ARCHIVED', '1.0.0')
    RETURNING id`;
  const sameClub = await asAdmin(
    sp,
    (inner) => inner`UPDATE tournaments SET event_id = ${DRAFT} WHERE id = ${archived}`,
  );
  if (sameClub)
    failures.push(
      `a Tournament moved to another Event of its club, its own archived ruleset kept, was refused (${sameClub.message})`,
    );
}

/** The admin of both clubs moves an Event, or a Tournament, to the other club. */
async function moveFailures(sp, failures) {
  await sp`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${OTHER}, ${ORG_ADMIN}, 'admin')`;
  await sp`
    INSERT INTO events (id, organization_id, slug, name, start_date, end_date, status, event_kind)
    VALUES
      (${MOVED}, ${CLUB}, 'rls-probe-moved', 'Moved', '2026-10-01', '2026-10-01', 'draft', 'standard'),
      (${MOVABLE}, ${CLUB}, 'rls-probe-movable', 'Movable', '2026-10-01', '2026-10-01', 'draft', 'standard'),
      (${ELSEWHERE}, ${OTHER}, 'rls-probe-elsewhere', 'Elsewhere', '2026-10-01', '2026-10-01', 'draft', 'standard')`;
  const [{ id: own }] = await sp`
    INSERT INTO tournaments (event_id, slug, name, ruleset_code, ruleset_version)
    VALUES
      (${MOVED}, 'own', 'Own', 'PROBE_OWN', '1.0.0'),
      (${MOVABLE}, 'built-in', 'Built-in', 'TF_v1', '1.1.0'),
      (${MOVABLE}, 'shared', 'Shared', 'PROBE_CLUB_SHARED', '1.0.0')
    RETURNING id`;
  const across = await asAdmin(
    sp,
    (inner) => inner`UPDATE tournaments SET event_id = ${ELSEWHERE} WHERE id = ${own}`,
  );
  if (!refusedBy(across, NOT_OFFERED))
    failures.push(
      `a Tournament moved to another club's Event kept its club's private ruleset (${across?.message ?? 'no error'})`,
    );
  const move = await asAdmin(
    sp,
    (inner) => inner`UPDATE events SET organization_id = ${OTHER} WHERE id = ${MOVED}`,
  );
  if (!refusedBy(move, MOVE_REFUSED))
    failures.push(
      `an Event moved to a club its Tournament's ruleset is private from (${move?.message ?? 'no error'})`,
    );
  const allowed = await asAdmin(
    sp,
    (inner) => inner`UPDATE events SET organization_id = ${OTHER} WHERE id = ${MOVABLE}`,
  );
  if (allowed)
    failures.push(
      `an Event whose Tournaments name a built-in and a ruleset its club shares could not move (${allowed.message})`,
    );
  const app = await attempt(
    sp,
    'service_role',
    (inner) => inner`UPDATE events SET organization_id = ${OTHER} WHERE id = ${MOVED}`,
  );
  if (app) failures.push(`the service role could not move an Event (${app.message})`);
}

const FUNCTIONS = [
  'ruleset_code_offered_to(text, uuid)',
  'ruleset_pair_in_its_club()',
  'ruleset_pairs_follow_event_move()',
];
// Each trigger and its table: a trigger's name is unique per table only.
const TRIGGERS = {
  tournaments_ruleset_pair_insert: 'tournaments',
  tournaments_ruleset_pair_update: 'tournaments',
  events_ruleset_pairs_follow_move: 'events',
};

/** The running database, whatever spelling a later migration used: definer, grants, triggers on. */
async function catalogueFailures(sp, failures) {
  for (const fn of FUNCTIONS) {
    const [row] = await sp`
      SELECT p.prosecdef AS definer,
        has_function_privilege('anon', ${`public.${fn}`}, 'EXECUTE') AS anon,
        has_function_privilege('authenticated', ${`public.${fn}`}, 'EXECUTE') AS authenticated
      FROM pg_proc p WHERE p.oid = ${`public.${fn}`}::regprocedure`;
    if (!row.definer) failures.push(`${fn} is not SECURITY DEFINER`);
    if (row.anon || row.authenticated) failures.push(`${fn} may be called over the web door`);
  }
  for (const [name, table] of Object.entries(TRIGGERS)) {
    const [row] = await sp`
      SELECT tgenabled, (tgtype::int & 2) = 0 AS after
      FROM pg_trigger WHERE tgname = ${name} AND tgrelid = ${`public.${table}`}::regclass`;
    if (!row || row.tgenabled !== 'O' || !row.after)
      failures.push(`trigger ${name} is missing, switched or not AFTER (${JSON.stringify(row)})`);
  }
}

/** What is wrong, as sentences; none when all is right. Leaves no row behind. */
export async function rulesetPairFailures(tx) {
  const failures = [];
  try {
    await tx.savepoint(async (sp) => {
      await catalogueFailures(sp, failures);
      await seedInside(sp);
      await writeFailures(sp, failures);
      await codeFailures(sp, failures);
      await exemptFailures(sp, failures);
      await storedPairFailures(sp, failures);
      await moveFailures(sp, failures);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return failures;
}
