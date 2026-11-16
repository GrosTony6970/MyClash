/**
 * Check 22 of the RLS probe (`scripts/db-rls-probe.mjs`): a signed-in reader reads nothing through
 * the database's web door (migration 0273, operator rulings 821 and 822).
 *
 * A signed-in account's own token opens PostgREST and the live channel as `authenticated`. There
 * the RLS helpers loop ("stack depth limit exceeded"), and on the live channel one such socket
 * stopped every viewer's updates (one poll is shared). So `authenticated` holds no SELECT on any
 * relation of `public`, a table made now does not give it one, no policy is left for it alone, and
 * a read as any signed-in account (a stranger, the club's admin, a super admin) is refused on
 * privilege (42501) everywhere: never a row, never the loop. Over the live catalogue, with no table
 * list to forget.
 */

const RELKINDS = ['r', 'p', 'v', 'm', 'f'];

/** The seed's accounts (rls-probe-seed.sql): a bystander, the club's admin, the super admin. */
const PERSONAS = {
  stranger: '44444444-4444-4444-8444-444444444444',
  'club admin': '11111111-1111-4111-8111-111111111111',
  'super admin': '22222222-2222-4222-8222-222222222222',
};

// Thrown to end a savepoint on purpose: the role, the claims and any table made end with it.
const ROLLBACK = new Error('rollback');

async function rolledBack(tx, run) {
  try {
    await tx.savepoint(async (sp) => {
      await run(sp);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}

/** Every relation of `public` (not an extension's) `authenticated` may read, as sentences. */
async function grantFailures(q, onlyTable = null) {
  const rows = await q`
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind = ANY (${RELKINDS}::char[])
      AND (${onlyTable}::text IS NULL OR c.relname = ${onlyTable})
      AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
      AND has_any_column_privilege('authenticated', c.oid, 'SELECT')
    ORDER BY c.relname`;
  return rows.map(
    ({ relname }) => `authenticated may read ${relname}: only the API reads for a signed-in user`,
  );
}

/** Default privileges that still give `authenticated` SELECT on a new table, and its own policies. */
async function catalogueFailures(tx) {
  const defaults = await tx`
    SELECT pg_get_userbyid(d.defaclrole) AS owner FROM pg_default_acl d
    CROSS JOIN aclexplode(d.defaclacl) AS a
    WHERE d.defaclobjtype = 'r' AND d.defaclnamespace IN (0, 'public'::regnamespace)
      AND a.privilege_type = 'SELECT' AND a.grantee = 'authenticated'::regrole
    ORDER BY 1`;
  const policies = await tx`
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND roles = ARRAY['authenticated']::name[]
    ORDER BY tablename, policyname`;
  return [
    ...defaults.map(({ owner }) => `a new table of ${owner} gives authenticated SELECT`),
    ...policies.map(
      ({ tablename, policyname }) =>
        `policy ${policyname} on ${tablename} serves authenticated alone, who reads nothing`,
    ),
  ];
}

/** A table made now by the migrations' role, rolled back, gives `authenticated` no SELECT. */
async function newTableFailures(tx) {
  const failures = [];
  await rolledBack(tx, async (sp) => {
    const [{ owner }] =
      await sp`SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'public.events'::regclass`;
    await sp`SELECT set_config('role', ${owner}, true)`;
    await sp`CREATE TABLE public.rls_probe_new_read_table (id int)`;
    await sp`RESET ROLE`;
    for (const failure of await grantFailures(sp, 'rls_probe_new_read_table'))
      failures.push(`a new table made by ${owner} starts readable: ${failure}`);
  });
  return failures;
}

/** As each signed-in persona, read every relation: each read must be refused on privilege. */
async function readFailures(tx) {
  const relations = await tx`
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = ANY (${RELKINDS}::char[])
      AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
    ORDER BY c.relname`;
  const failures = [];
  for (const [persona, sub] of Object.entries(PERSONAS)) {
    const claims = JSON.stringify({ role: 'authenticated', sub });
    const wrong = [];
    for (const { relname } of relations) {
      await rolledBack(tx, async (sp) => {
        await sp`SET LOCAL ROLE authenticated`;
        await sp`SELECT set_config('request.jwt.claims', ${claims}, true)`;
        try {
          await sp`SELECT count(*) FROM ${sp(relname)}`;
          wrong.push(`${relname} (read)`);
        } catch (error) {
          if (error.code !== '42501') wrong.push(`${relname} (${error.message})`);
        }
      });
    }
    if (wrong.length > 0)
      failures.push(
        `signed in as the ${persona}, ${wrong.length} of ${relations.length} relations were not refused on privilege: ${wrong.slice(0, 5).join(', ')}${wrong.length > 5 ? ', …' : ''}`,
      );
  }
  if (relations.length === 0) failures.push('check 22 found no relation to read');
  return failures;
}

/** What is wrong, as sentences; none when all is right. Leaves no row behind. */
export async function signedInReadsFailures(tx) {
  return [
    ...(await grantFailures(tx)),
    ...(await catalogueFailures(tx)),
    ...(await newTableFailures(tx)),
    ...(await readFailures(tx)),
  ];
}
