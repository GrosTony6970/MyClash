/**
 * Check 24 of the RLS probe (`scripts/db-rls-probe.mjs`): the web roles run only the helpers the
 * read rules call (migration 0275, operator ruling 826).
 *
 * Every function made in `public` used to start executable by PUBLIC, anon and authenticated, so
 * the public key could call over /rest/v1/rpc any of them no migration had revoked by hand, and a
 * function added without its revokes opened the day it landed. Over the live catalogue, with no
 * function list:
 *   (a) anon runs exactly the helpers a read rule needs: the functions in `public` a rule on a
 *       `public` table depends on, closed over what they call (pg_depend, or a call of the name in
 *       the body). Policy evaluation runs as the reader, so a helper anon cannot run fails the
 *       reads that reach it. A view anon reads that calls a function is not counted (none of ours
 *       does: it needs a ruling; an extension's views are skipped here, as in check 1);
 *   (b) authenticated and PUBLIC run no function of `public`;
 *   (c) no SECURITY DEFINER function of `public` is open to anon, authenticated or PUBLIC;
 *   (d) a function and a sequence made now by the migrations' role start closed to all three;
 *   (e) the service role runs every function of `public` (the API's calls);
 *   (f) no sequence of `public` is usable by anon, authenticated or PUBLIC;
 *   (g) every function anon runs is needed: taken away, some anonymous read fails on it. This does
 *       not share (a)'s derivation, whose body match is text and would also count a name in a
 *       comment. It needs rows: run after the seed.
 */

const WEB = ['anon', 'authenticated', 'public'];

// The read rules' helpers, closed over their callees. String.raw: the backslashes reach Postgres.
const HELPERS = String.raw`
  WITH RECURSIVE helpers(oid) AS (
    SELECT DISTINCT p.oid FROM pg_policy pol
    JOIN pg_class rel ON rel.oid = pol.polrelid AND rel.relnamespace = 'public'::regnamespace
    JOIN pg_depend d ON d.classid = 'pg_policy'::regclass AND d.objid = pol.oid
                    AND d.refclassid = 'pg_proc'::regclass
    JOIN pg_proc p ON p.oid = d.refobjid AND p.pronamespace = 'public'::regnamespace
    UNION
    SELECT callee.oid FROM helpers h
    JOIN pg_proc caller ON caller.oid = h.oid
    JOIN pg_proc callee ON callee.pronamespace = 'public'::regnamespace
    WHERE EXISTS (SELECT 1 FROM pg_depend d
                  WHERE d.classid = 'pg_proc'::regclass AND d.objid = caller.oid
                    AND d.refclassid = 'pg_proc'::regclass AND d.refobjid = callee.oid)
       OR caller.prosrc ~* ('(^|[^.[:alnum:]_"])' || callee.proname || '\s*\(')
       OR caller.prosrc ~* ('public\.' || callee.proname || '\s*\(')
  )`;

// Thrown to end a savepoint on purpose: whatever ran inside it ends with it.
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

/** (a) to (c), (e) and (f), off the catalogue, as sentences. */
async function catalogueFailures(tx) {
  const rows = await tx.unsafe(`${HELPERS}
    SELECT p.oid::regprocedure::text AS fn, (h.oid IS NOT NULL) AS needed, p.prosecdef AS definer,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
           has_function_privilege('public', p.oid, 'EXECUTE') AS public,
           has_function_privilege('service_role', p.oid, 'EXECUTE') AS service
    FROM pg_proc p LEFT JOIN helpers h ON h.oid = p.oid
    WHERE p.pronamespace = 'public'::regnamespace ORDER BY 1`);
  const failures = [];
  if (!rows.some((row) => row.needed))
    failures.push('no read rule calls a helper: (a) checked nothing');
  for (const row of rows) {
    if (row.anon && !row.needed) failures.push(`anon runs ${row.fn}, which no read rule needs`);
    if (!row.anon && row.needed)
      failures.push(`anon cannot run ${row.fn}, which a read rule needs`);
    for (const who of ['authenticated', 'public'])
      if (row[who]) failures.push(`${who} runs ${row.fn}: no web role calls a function`);
    if (row.definer && WEB.some((who) => row[who]))
      failures.push(`${row.fn} is SECURITY DEFINER and open to a web role`);
    if (!row.service) failures.push(`the service role cannot run ${row.fn}`);
  }
  const sequences = await tx`
    SELECT c.oid::regclass::text AS seq, r.who FROM pg_class c
    CROSS JOIN unnest(${WEB}::text[]) AS r(who)
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
      AND has_sequence_privilege(r.who, c.oid, 'USAGE, SELECT, UPDATE')
    ORDER BY 1, 2`;
  for (const { seq, who } of sequences) failures.push(`${who} may use the sequence ${seq}`);
  return failures;
}

/** (d) A function and a sequence made now by the owner of `public.events` start closed. */
async function newObjectFailures(tx) {
  const failures = [];
  await rolledBack(tx, async (sp) => {
    const [{ owner }] =
      await sp`SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'public.events'::regclass`;
    await sp`SELECT set_config('role', ${owner}, true)`;
    await sp`CREATE FUNCTION public.function_door_probe() RETURNS int LANGUAGE sql AS 'SELECT 1'`;
    await sp`CREATE SEQUENCE public.function_door_probe_seq`;
    const [row] = await sp`
      SELECT bool_or(has_function_privilege(w, 'public.function_door_probe()'::regprocedure, 'EXECUTE')) AS runs,
             bool_or(has_sequence_privilege(w, 'public.function_door_probe_seq'::regclass, 'USAGE, SELECT, UPDATE')) AS uses
      FROM unnest(${WEB}::text[]) AS w`;
    if (row.runs) failures.push(`a function made by ${owner} starts open to a web role`);
    if (row.uses) failures.push(`a sequence made by ${owner} starts open to a web role`);
  });
  return failures;
}

/** Whether some anonymous read of `public` fails on `fn` (named `name`) once anon may not run it. */
async function someReadNeeds(tx, { fn, name }, relations) {
  const refusal = `permission denied for function ${name}`;
  let needed = false;
  await rolledBack(tx, async (sp) => {
    await sp.unsafe(`REVOKE EXECUTE ON FUNCTION ${fn} FROM anon`);
    for (const relname of relations) {
      try {
        await rolledBack(sp, async (read) => {
          await read`SET LOCAL ROLE anon`;
          await read`SELECT set_config('request.jwt.claims', '{"role":"anon"}', true)`;
          await read`SELECT count(*) FROM ${read(relname)}`;
        });
      } catch (error) {
        // Any other error is check 1's to report; only this function's refusal counts here.
        if (error.code === '42501' && error.message === refusal) {
          needed = true;
          return;
        }
      }
    }
  });
  return needed;
}

/** (g) Every function anon runs is needed by some anonymous read. */
async function loadBearingFailures(tx) {
  const granted = await tx`
    SELECT p.oid::regprocedure::text AS fn, p.proname AS name FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege('anon', p.oid, 'EXECUTE')
    ORDER BY 1`;
  const relations = (
    await tx`
      SELECT c.relname FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
        AND has_any_column_privilege('anon', c.oid, 'SELECT')
        AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
      ORDER BY c.relname`
  ).map((row) => row.relname);
  const failures = [];
  for (const row of granted)
    if (!(await someReadNeeds(tx, row, relations)))
      failures.push(`anon runs ${row.fn}, but no anonymous read fails without it`);
  return failures;
}

/** What is wrong, as sentences; none when all is right. Each part leaves no row behind. */
export async function functionDoorFailures(tx) {
  return [
    ...(await catalogueFailures(tx)),
    ...(await newObjectFailures(tx)),
    ...(await loadBearingFailures(tx)),
  ];
}
