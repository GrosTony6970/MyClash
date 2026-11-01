/**
 * Check 20 of the RLS probe (`scripts/db-rls-probe.mjs`): no table takes a write through the
 * database's web door, and a new table starts closed (migration 0247, operator rulings 98 and 226).
 *
 * Only the API writes, as the service role. So over the live catalogue, with no table list to
 * forget: no relation in `public` (not an extension's) gives anon or authenticated INSERT or UPDATE
 * on any column, or DELETE; no policy in `public` lets either write; and a table made now, by the
 * role that owns `public.events` (the role the migrations run as in that database), gives them
 * neither, because the default privileges no longer do. A column grant counts: PostgREST writes
 * through it as well as through a table grant.
 */

const WEB_ROLES = ['anon', 'authenticated'];
const RELKINDS = ['r', 'p', 'v', 'm', 'f'];

// Thrown to end a savepoint on purpose: the table made inside it ends with it.
const ROLLBACK = new Error('rollback');

/** Every web write privilege on relations of `public` the migrations made, as sentences. */
async function privilegeFailures(sp, onlyTable = null) {
  const rows = await sp`
    SELECT c.relname, r.role, v.verb
    FROM pg_class c
    CROSS JOIN unnest(${WEB_ROLES}::text[]) AS r(role)
    CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) AS v(verb)
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind = ANY (${RELKINDS}::char[])
      AND (${onlyTable}::text IS NULL OR c.relname = ${onlyTable})
      AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
      AND CASE WHEN v.verb = 'DELETE' THEN has_table_privilege(r.role, c.oid, v.verb)
               ELSE has_any_column_privilege(r.role, c.oid, v.verb) END
    ORDER BY c.relname, r.role, v.verb`;
  return rows.map(
    ({ relname, role, verb }) => `${role} may ${verb} ${relname}: only the API writes`,
  );
}

/** Every policy in `public` that lets a web role write, as sentences. */
async function policyFailures(sp) {
  const rows = await sp`
    SELECT tablename, policyname, cmd FROM pg_policies
    WHERE schemaname = 'public' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND roles && ARRAY['anon', 'authenticated', 'public']::name[]
    ORDER BY tablename, policyname`;
  return rows.map(
    ({ tablename, policyname, cmd }) =>
      `policy ${policyname} (${cmd}) on ${tablename} lets a web role write: only the API writes`,
  );
}

/** A table made now by the migrations' role, rolled back, is closed to the web roles. */
async function newTableFailures(tx) {
  const failures = [];
  try {
    await tx.savepoint(async (sp) => {
      const [{ owner }] =
        await sp`SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'public.events'::regclass`;
      await sp`SELECT set_config('role', ${owner}, true)`;
      await sp`CREATE TABLE public.rls_probe_new_table (id int)`;
      await sp`RESET ROLE`;
      for (const failure of await privilegeFailures(sp, 'rls_probe_new_table'))
        failures.push(`a new table made by ${owner} starts open: ${failure}`);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return failures;
}

/** What is wrong, as sentences; none when all is right. Leaves no row behind. */
export async function webWriteDoorsFailures(tx) {
  return [
    ...(await privilegeFailures(tx)),
    ...(await policyFailures(tx)),
    ...(await newTableFailures(tx)),
  ];
}
