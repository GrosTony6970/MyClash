/**
 * Check 21 of the RLS probe (`scripts/db-rls-probe.mjs`): the web roles read no fighter profile
 * through the database's web door (migration 0272, operator rulings 820 and 823).
 *
 * `global_persons_select` (0187) chose which rows the public saw and hid no column: a listed
 * fighter's email and date of birth went to anyone holding the anon key. Now neither web role may
 * read any column of `global_persons`, no policy is left on it, and `lookup_global_persons` (which
 * reads it) is closed to both and to PUBLIC, but answers the service role: the API's fuzzy
 * directory search calls it, and falls back to a plain match in silence on any error.
 *
 * The read is tried on a fighter who is claimed and listed in the directory, the one row 0187
 * showed the public, with an address and a date of birth: an empty table would prove nothing about
 * the columns, only about the privilege.
 */

const WEB_ROLES = ['anon', 'authenticated'];
const LOOKUP = 'public.lookup_global_persons(text, integer, double precision)';

/** The seed's bystander (rls-probe-seed.sql): an account that claims no profile there. */
const BYSTANDER = '44444444-4444-4444-8444-444444444444';
const LISTED = '9e000000-0000-4000-8000-0000000000f1';

// Thrown to end a savepoint on purpose: the role, the claims and the listed fighter end with it.
const ROLLBACK = new Error('rollback');

/** What a role was given on the table and the function, as sentences. */
async function privilegeFailures(tx) {
  const failures = [];
  for (const role of WEB_ROLES) {
    const [{ reads, calls }] = await tx`
      SELECT has_any_column_privilege(${role}, 'public.global_persons'::regclass, 'SELECT') AS reads,
             has_function_privilege(${role}, ${LOOKUP}::regprocedure, 'EXECUTE') AS calls`;
    if (reads)
      failures.push(`${role} may read global_persons: only the API reads fighter profiles`);
    if (calls)
      failures.push(`${role} may call lookup_global_persons: it reads fighter profiles for them`);
  }
  const policies = await tx`
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'global_persons' ORDER BY policyname`;
  for (const { policyname } of policies)
    failures.push(`policy ${policyname} is left on global_persons: no web role reads the table`);
  return failures;
}

/** As each web role, read the listed fighter's private columns: each must be refused (42501). */
async function readFailures(tx) {
  const failures = [];
  const signedIn = JSON.stringify({ role: 'authenticated', sub: BYSTANDER });
  const become = {
    anon: (sp) => sp`SELECT set_config('request.jwt.claims', '{"role":"anon"}', true)`,
    authenticated: (sp) => sp`SELECT set_config('request.jwt.claims', ${signedIn}, true)`,
  };
  for (const role of WEB_ROLES) {
    try {
      await tx.savepoint(async (sp) => {
        await sp`
          INSERT INTO global_persons (id, slug, display_name, given_name, family_name, email,
            date_of_birth, is_fighter, claimed_by_user_id, listed_in_directory)
          VALUES (${LISTED}, 'rls-probe-listed', 'Probe Listed', 'Probe', 'Listed',
            'rls-probe-listed@example.test', '2000-01-01', true, ${BYSTANDER}, true)`;
        await sp.unsafe(`SET LOCAL ROLE ${role}`);
        await become[role](sp);
        try {
          const rows = await sp`
            SELECT email, date_of_birth FROM global_persons WHERE id = ${LISTED}`;
          failures.push(
            `${role} read global_persons (${rows.length} row): a listed fighter's email and date of birth`,
          );
        } catch (error) {
          if (error.code !== '42501')
            failures.push(
              `${role}'s read of global_persons failed, not on privilege: ${error.message}`,
            );
        }
        throw ROLLBACK;
      });
    } catch (error) {
      if (error !== ROLLBACK) throw error;
    }
  }
  return failures;
}

/** The API's call, as the service role: it must answer, not fail. */
async function serviceRoleFailures(tx) {
  let failure = null;
  try {
    await tx.savepoint(async (sp) => {
      await sp`SET LOCAL ROLE service_role`;
      try {
        await sp`SELECT count(*) FROM public.lookup_global_persons('probe', 5, 0.2)`;
      } catch (error) {
        failure = error;
      }
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return failure ? [`the service role cannot call lookup_global_persons: ${failure.message}`] : [];
}

/** What is wrong, as sentences; none when all is right. Leaves no row behind. */
export async function globalPersonsDoorFailures(tx) {
  return [
    ...(await privilegeFailures(tx)),
    ...(await readFailures(tx)),
    ...(await serviceRoleFailures(tx)),
  ];
}
