/**
 * Check 23 of the RLS probe (`scripts/db-rls-probe.mjs`): every rule in `public` can run for
 * someone (migration 0274, operator rulings 825 and 835).
 *
 * Since 0247 no web role writes and since 0273 `authenticated` reads nothing, so a write rule, a
 * rule for `authenticated`, or one for a role that bypasses RLS (the service role) never runs: it
 * looks like a door and opens for no one. 0274 dropped two such rules (`service_role_all`), and 36
 * `TO public` rules no reader could pass, which this check cannot see. Over the live catalogue,
 * with no rule list: every rule is a read rule, and EVERY role it names (PUBLIC is reached as
 * anon) holds SELECT on at least one column of its table (three tables are split per column) and
 * does not bypass RLS. And `is_platform_staff`, whose only caller went, stays gone.
 *
 * What this cannot see: a rule `TO public` whose every branch is false for anon (a helper that
 * needs an account). That is judged by reading the rule; 0274's 38 are pinned by name in
 * packages/db/test/dead-read-rules-dropped.test.ts.
 */

/** What is wrong, as sentences; none when all is right. Reads the catalogue only. */
export async function deadPolicyFailures(tx) {
  const notReads = await tx`
    SELECT p.polname, c.relname, p.polcmd FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relnamespace = 'public'::regnamespace AND p.polcmd <> 'r'
    ORDER BY c.relname, p.polname`;
  const unrunnable = await tx`
    SELECT p.polname, c.relname, r.role_name FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    CROSS JOIN LATERAL unnest(p.polroles) AS pr(oid)
    CROSS JOIN LATERAL (SELECT CASE WHEN pr.oid = 0 THEN 'anon'
                                    ELSE pg_get_userbyid(pr.oid) END AS role_name) r
    WHERE c.relnamespace = 'public'::regnamespace
      AND (NOT has_any_column_privilege(r.role_name, c.oid, 'SELECT')
           OR (SELECT rolbypassrls FROM pg_roles WHERE rolname = r.role_name))
    ORDER BY c.relname, p.polname, r.role_name`;
  const staff = await tx`
    SELECT oid::regprocedure::text AS fn FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname = 'is_platform_staff'`;
  return [
    ...notReads.map(
      ({ polname, relname, polcmd }) =>
        `policy ${polname} on ${relname} is not a read rule (${polcmd}): no web role writes`,
    ),
    ...unrunnable.map(
      ({ polname, relname, role_name: role }) =>
        `policy ${polname} on ${relname} names ${role}, who cannot run it (no SELECT, or bypasses RLS)`,
    ),
    ...staff.map(({ fn }) => `${fn} is back: no rule calls it since 0274`),
  ];
}
