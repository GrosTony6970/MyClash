/**
 * Check 10 of the RLS probe (`scripts/db-rls-probe.mjs`): a ruleset code has one row (migration
 * 0224, operator ruling "One tag"), and 0224's triggers stay gone.
 *
 * Only the API writes a Tournament since 0233 and an Event since 0247 (check 5 refuses both on
 * privilege; check 20 reads every table off the catalogue), so 0224's two Tournament triggers and their function went with 0233 (ruling
 * "0224 triggers"), and its Event-move trigger, its function and its helper with 0247 (ruling
 * 229): each refused only a web writer, and none is left. This checks they stay gone. No ruleset
 * row, even one the API writes, may take a code another owner holds (a decoy, or a squatter on a
 * built-in's code).
 */

import { ORG_ADMIN } from './rls-probe-tables.mjs';

// The Club of `rls-probe-seed.sql`, and the other club this check makes.
const CLUB = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'aaaaaaaa-0000-4000-8000-0000000000b2';

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

/** As the owner: the other club and its own live ruleset. */
async function seedInside(sp) {
  await sp`INSERT INTO organizations (id, slug, name) VALUES (${OTHER}, 'rls-probe-other', 'Other')`;
  await sp`
    INSERT INTO custom_rulesets
      (code, version, name, status, owner_organization_id, public_visibility, is_system,
       decision_edition)
    VALUES ('PROBE_PRIVATE', '1.0.0', 'PROBE_PRIVATE', 'published', ${OTHER}, false, false, '2026-10')`;
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

const DROPPED_FUNCTIONS = [
  'ruleset_pair_in_its_club()',
  'ruleset_pairs_follow_event_move()',
  'ruleset_code_offered_to(text, uuid)',
];
const DROPPED_TRIGGERS = [
  ['tournaments_ruleset_pair_insert', 'public.tournaments'],
  ['tournaments_ruleset_pair_update', 'public.tournaments'],
  ['events_ruleset_pairs_follow_move', 'public.events'],
];

/** The running database, whatever spelling a later migration used: 0224's triggers and functions stay gone. */
async function catalogueFailures(sp, failures) {
  for (const [tgname, table] of DROPPED_TRIGGERS) {
    const back =
      await sp`SELECT 1 FROM pg_trigger WHERE tgname = ${tgname} AND tgrelid = ${table}::regclass`;
    if (back.length > 0) failures.push(`the 0224 trigger ${tgname} is back on ${table}`);
  }
  for (const signature of DROPPED_FUNCTIONS) {
    const [{ fn }] = await sp`SELECT to_regprocedure(${`public.${signature}`})::text AS fn`;
    if (fn !== null) failures.push(`the 0224 function ${signature} is back`);
  }
}

/** What is wrong, as sentences; none when all is right. Leaves no row behind. */
export async function rulesetPairFailures(tx) {
  const failures = [];
  try {
    await tx.savepoint(async (sp) => {
      await catalogueFailures(sp, failures);
      await seedInside(sp);
      await codeFailures(sp, failures);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return failures;
}
