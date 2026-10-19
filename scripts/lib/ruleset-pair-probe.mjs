/**
 * Check 10 of the RLS probe (`scripts/db-rls-probe.mjs`): an Event moved through PostgREST takes no
 * Tournament to a club that may not use its ruleset, and a ruleset code has one row (migration
 * 0224, operator rulings "Pair through the DB", "One tag", "Platform draft", "Exempt list").
 *
 * Only the API writes a Tournament since 0233 (check 5 refuses the web door on privilege), so
 * 0224's two Tournament triggers and their function are gone (ruling "0224 triggers"): this
 * checks they stay gone. Events stay writable by an organisation admin: an Event moved to another
 * organisation may keep only Tournaments whose rulesets the new one is offered (a built-in, a live
 * ruleset shared platform-wide or its own live one); never an archived one or a draft, the
 * platform's included, nor a row marked `is_system` by a club. No ruleset row, even one the API
 * writes, may take a code another owner holds (a decoy, or a squatter on a built-in's code). The
 * service role is exempt (the API decides at its doors); a role added later is not.
 */

import { ORG_ADMIN } from './rls-probe-tables.mjs';

// The Club of `rls-probe-seed.sql`, and the club and Events this check makes.
const CLUB = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'aaaaaaaa-0000-4000-8000-0000000000b2';
const MOVED = 'eeeeeeee-0000-4000-8000-0000000000b2';
const MOVABLE = 'eeeeeeee-0000-4000-8000-0000000000b3';

const MOVE_REFUSED = 'A Tournament of this Event names a ruleset the new organisation may not use';

const RULESETS = [
  // [code, owner, shared, status, is_system]
  ['PROBE_OWN', CLUB, false, 'published', false],
  ['PROBE_CLUB_SHARED', CLUB, true, 'published', false],
  // The other club's own live ruleset: offered to it by ownership.
  ['PROBE_PRIVATE', OTHER, false, 'published', false],
  // Its own, but not live; the platform's draft; a row of its own marked `is_system`, which does
  // not make it a built-in. Each is refused to it whatever its owner.
  ['PROBE_OTHER_ARCHIVED', OTHER, false, 'archived', false],
  ['PROBE_OTHER_DRAFT', OTHER, false, 'draft', false],
  ['PROBE_PLATFORM_DRAFT', null, true, 'draft', false],
  ['PROBE_OTHER_MARKED_SYSTEM', OTHER, false, 'published', true],
];

/** One Event of the Club per ruleset the other club is not offered, each with one Tournament. */
const NOT_OFFERED = [
  ['eeeeeeee-0000-4000-8000-0000000000c1', 'PROBE_OTHER_ARCHIVED'],
  ['eeeeeeee-0000-4000-8000-0000000000c2', 'PROBE_OTHER_DRAFT'],
  ['eeeeeeee-0000-4000-8000-0000000000c3', 'PROBE_PLATFORM_DRAFT'],
  ['eeeeeeee-0000-4000-8000-0000000000c4', 'PROBE_OTHER_MARKED_SYSTEM'],
];

// Thrown to end a savepoint on purpose: the rows inside it end with it.
const ROLLBACK = new Error('rollback');

/**
 * `statement` as `role`, signed in as `sub` (the Club's admin by default), in a savepoint always
 * rolled back: a released one would keep the role for the rest of the transaction. Its error, or
 * null.
 */
export async function attempt(tx, role, statement, sub = ORG_ADMIN) {
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

/** Refused by 0224 itself: its error code AND its words, not a CHECK or a trigger of another rule. */
const refusedBy = (error, message) => error?.code === '23514' && error.message === message;

/**
 * A signed-in write of `events` loops through the RLS helpers of its policy checks today ("stack
 * depth limit exceeded", ruling 111a leaves it latent), so the write never lands. The day the loop
 * is fixed is the day the trigger matters: the helpers run as SECURITY DEFINER here, inside the
 * savepoint, which the probe always rolls back.
 */
const LOOPING_HELPERS = [
  'is_super_admin()',
  'is_platform_staff()',
  'is_org_member(uuid)',
  'has_org_role(uuid, text)',
];

/** As the owner: the rulesets, the other club with the Club's admin in it, and two Events. */
async function seedInside(sp) {
  for (const helper of LOOPING_HELPERS)
    await sp.unsafe(`ALTER FUNCTION public.${helper} SECURITY DEFINER`);
  await sp`INSERT INTO organizations (id, slug, name) VALUES (${OTHER}, 'rls-probe-other', 'Other')`;
  await sp`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${OTHER}, ${ORG_ADMIN}, 'admin')`;
  for (const [code, owner, shared, status, system] of RULESETS)
    await sp`
      INSERT INTO custom_rulesets
        (code, version, name, status, owner_organization_id, public_visibility, is_system,
         decision_edition)
      VALUES (${code}, '1.0.0', ${code}, ${status}, ${owner}, ${shared}, ${system}, '2026-10')`;
  for (const [id, slug] of [
    [MOVED, 'rls-probe-moved'],
    [MOVABLE, 'rls-probe-movable'],
    ...NOT_OFFERED.map(([event, code]) => [event, `rls-probe-${code.toLowerCase()}`]),
  ])
    await sp`
      INSERT INTO events (id, organization_id, slug, name, start_date, end_date, status, event_kind)
      VALUES (${id}, ${CLUB}, ${slug}, ${slug}, '2026-10-01', '2026-10-01', 'draft', 'standard')`;
  await sp`
    INSERT INTO tournaments (event_id, slug, name, ruleset_code, ruleset_version)
    VALUES
      (${MOVED}, 'own', 'Own', 'PROBE_OWN', '1.0.0'),
      (${MOVABLE}, 'built-in', 'Built-in', 'TF_v1', '1.1.0'),
      (${MOVABLE}, 'shared', 'Shared', 'PROBE_CLUB_SHARED', '1.0.0'),
      (${MOVABLE}, 'its-own', 'Its own', 'PROBE_PRIVATE', '1.0.0')`;
  for (const [event, code] of NOT_OFFERED)
    await sp`
      INSERT INTO tournaments (event_id, slug, name, ruleset_code, ruleset_version)
      VALUES (${event}, 'held', 'Held', ${code}, '1.0.0')`;
}

/** A row of the Club's own may not take a code another owner holds: no decoy, no squatter. */
async function codeFailures(sp, failures) {
  // As the service role: only the API writes a ruleset row (0225), and the index refuses it too.
  for (const code of ['PROBE_PRIVATE', 'TF_v1']) {
    const error = await attempt(
      sp,
      'service_role',
      (inner) => inner`
        INSERT INTO custom_rulesets
          (code, version, name, status, owner_organization_id, decision_edition)
        VALUES (${code}, '1.0.0', 'Decoy', 'published', ${CLUB}, '2026-10')`,
    );
    if (error?.code !== '23505' || error.constraint_name !== 'custom_rulesets_code_unique_idx')
      failures.push(
        `a row of the Club's own took code ${code}, which another owner holds (${error?.message ?? 'no error'})`,
      );
  }
}

/** The admin of both clubs moves an Event to the other club. */
async function moveFailures(sp, failures) {
  const move = (inner) => inner`UPDATE events SET organization_id = ${OTHER} WHERE id = ${MOVED}`;
  const refused = await asAdmin(sp, move);
  if (!refusedBy(refused, MOVE_REFUSED))
    failures.push(
      `an Event moved to a club its Tournament's ruleset is private from (${refused?.message ?? 'no error'})`,
    );
  for (const [event, code] of NOT_OFFERED) {
    const held = await asAdmin(
      sp,
      (inner) => inner`UPDATE events SET organization_id = ${OTHER} WHERE id = ${event}`,
    );
    if (!refusedBy(held, MOVE_REFUSED))
      failures.push(
        `an Event moved to a club that is not offered ${code} (${held?.message ?? 'no error'})`,
      );
  }
  const allowed = await asAdmin(
    sp,
    (inner) => inner`UPDATE events SET organization_id = ${OTHER} WHERE id = ${MOVABLE}`,
  );
  if (allowed)
    failures.push(
      `an Event whose Tournaments name a built-in, a ruleset its club shares and the new club's own could not move (${allowed.message})`,
    );
  const app = await attempt(sp, 'service_role', move);
  if (app) failures.push(`the service role could not move an Event (${app.message})`);
  await sp`CREATE ROLE rls_probe_new_role NOLOGIN`;
  // A new role for the web door, with the signed-in user's grants.
  await sp`GRANT authenticated TO rls_probe_new_role`;
  const added = await attempt(sp, 'rls_probe_new_role', move);
  if (!refusedBy(added, MOVE_REFUSED))
    failures.push(
      `a role added later moved the Event (${added?.message ?? 'no error'}): only the service role is exempt`,
    );
}

const FUNCTIONS = ['ruleset_code_offered_to(text, uuid)', 'ruleset_pairs_follow_event_move()'];
const DROPPED_TRIGGERS = ['tournaments_ruleset_pair_insert', 'tournaments_ruleset_pair_update'];

/**
 * The running database, whatever spelling a later migration used: definer, grants, the Event-move
 * trigger on; the Tournament triggers and their function gone (0233).
 */
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
  const [trigger] = await sp`
    SELECT tgenabled, (tgtype::int & 2) = 0 AS after
    FROM pg_trigger
    WHERE tgname = 'events_ruleset_pairs_follow_move' AND tgrelid = 'public.events'::regclass`;
  if (!trigger || trigger.tgenabled !== 'O' || !trigger.after)
    failures.push(
      `trigger events_ruleset_pairs_follow_move is missing, switched or not AFTER (${JSON.stringify(trigger)})`,
    );
  const back = await sp`
    SELECT tgname FROM pg_trigger
    WHERE tgname = ANY (${DROPPED_TRIGGERS}) AND tgrelid = 'public.tournaments'::regclass`;
  for (const { tgname } of back) failures.push(`the 0224 trigger ${tgname} is back on tournaments`);
  const [{ fn }] =
    await sp`SELECT to_regprocedure('public.ruleset_pair_in_its_club()')::text AS fn`;
  if (fn !== null) failures.push('the 0224 function ruleset_pair_in_its_club() is back');
}

/** What is wrong, as sentences; none when all is right. Leaves no row behind. */
export async function rulesetPairFailures(tx) {
  const failures = [];
  try {
    await tx.savepoint(async (sp) => {
      await catalogueFailures(sp, failures);
      await seedInside(sp);
      await codeFailures(sp, failures);
      await moveFailures(sp, failures);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return failures;
}
