/**
 * The anonymous RLS probe (operator ruling 114): reads a freshly replayed database as the anonymous
 * visitor that PostgREST and the live channel serve, and fails on any error or leak.
 *
 * Why it exists. Before 0201, ONE platform_roles row made every anonymous RLS read error ("stack
 * depth limit exceeded"): a helper read a guarded table whose policy called the helper again. Every
 * static gate was green, because the loop only happens when Postgres evaluates a policy over a
 * row. This gate evaluates it.
 *
 * Run it after `pnpm db:migrations:replay`, on the same disposable database:
 *   DATABASE_URL=postgres://… pnpm db:rls-probe
 *
 * It seeds rls-probe-seed.sql and checks, past RLS, that every row a verdict names exists. Then
 * three checks, all as anon (JWT claims with no `sub`), each in a savepoint rolled back after it;
 * the whole run is one transaction, always rolled back, so nothing it wrote survives:
 *   1. every relation anon may SELECT answers without an error;
 *   2. the seeded rows split exactly: the published Event's published Tournament is visible; the
 *      draft Event's side, a draft Tournament's side (even under the published Event), the private
 *      League, the club's own ruleset, the membership and the platform role are hidden;
 *   3. every view in `public` runs as its caller (security_invoker) — the runtime twin of
 *      db:review's static rule, which missed 0193.
 * Signed-in reads are out of scope: ruling 111a leaves their loop latent on purpose.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error(
    'DATABASE_URL is required and must point at a disposable, freshly replayed database (pnpm db:migrations:replay).',
  );
  process.exit(1);
}

const seedPath = join(process.cwd(), 'packages', 'db', 'fixtures', 'rls-probe-seed.sql');

/** Per table, the seeded keys anon must see and the ones it must not. Keys are in the seed file. */
const VERDICTS = [
  {
    table: 'events',
    key: 'id',
    visible: ['eeeeeeee-0000-4000-8000-00000000000a'],
    hidden: ['eeeeeeee-0000-4000-8000-00000000000b'],
  },
  {
    table: 'tournaments',
    key: 'id',
    visible: ['77777777-0000-4000-8000-00000000000a'],
    hidden: [
      '77777777-0000-4000-8000-00000000000b',
      '77777777-0000-4000-8000-00000000000c',
      '77777777-0000-4000-8000-00000000000d',
    ],
  },
  {
    table: 'phases',
    key: 'id',
    visible: ['99999999-0000-4000-8000-00000000000a'],
    hidden: ['99999999-0000-4000-8000-00000000000b', '99999999-0000-4000-8000-00000000000c'],
  },
  {
    table: 'matches',
    key: 'id',
    visible: ['dddddddd-0000-4000-8000-00000000000a'],
    hidden: ['dddddddd-0000-4000-8000-00000000000b', 'dddddddd-0000-4000-8000-00000000000c'],
  },
  {
    table: 'registrations',
    key: 'id',
    visible: ['cccccccc-0000-4000-8000-00000000000a'],
    hidden: ['cccccccc-0000-4000-8000-00000000000c'],
  },
  {
    table: 'leagues',
    key: 'id',
    visible: ['1eaa0000-0000-4000-8000-00000000000a'],
    hidden: ['1eaa0000-0000-4000-8000-00000000000b'],
  },
  {
    table: 'penalty_rulesets',
    key: 'id',
    visible: [],
    hidden: ['fe000000-0000-4000-8000-00000000000a'],
  },
  {
    table: 'organization_members',
    key: 'user_id',
    visible: [],
    hidden: ['11111111-1111-4111-8111-111111111111'],
  },
  {
    table: 'platform_roles',
    key: 'user_id',
    visible: [],
    hidden: ['22222222-2222-4222-8222-222222222222'],
  },
];

const sql = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10,
  onnotice: () => {},
});
const failures = [];
// Thrown to end a transaction or savepoint on purpose: whatever ran inside it is rolled back.
const ROLLBACK = new Error('rollback');

async function rolledBack(run) {
  try {
    await run();
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}

/** Runs `read` as anon in a savepoint that is always rolled back, so the role and claims end with it. */
async function asAnon(tx, read) {
  let result;
  await rolledBack(() =>
    tx.savepoint(async (sp) => {
      await sp`SET LOCAL ROLE anon`;
      await sp`SELECT set_config('request.jwt.claims', '{"role":"anon"}', true)`;
      result = await read(sp);
      throw ROLLBACK;
    }),
  );
  return result;
}

/** The keys of one verdict's seeded rows that `q` can see. */
async function seenKeys(q, { table, key, visible, hidden }) {
  const keys = [...visible, ...hidden];
  const rows =
    await q`SELECT ${q(key)}::text AS k FROM ${q(table)} WHERE ${q(key)}::text = ANY(${keys})`;
  return new Set(rows.map((row) => row.k));
}

// Relations an extension owns (pg_stat_statements on a vanilla replay) are not ours to probe:
// Supabase keeps them in the `extensions` schema, and a replay may not preload their library.
const ours = (q) =>
  q`NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')`;

/** A "hidden" verdict on a row the seed never wrote would pass: check every key exists, past RLS. */
async function seededRowsExist(tx) {
  for (const verdict of VERDICTS) {
    const found = await seenKeys(tx, verdict);
    const absent = [...verdict.visible, ...verdict.hidden].filter((k) => !found.has(k));
    if (absent.length > 0)
      failures.push(`the seed did not write ${verdict.table} ${absent.join(', ')}`);
  }
}

async function readsWithoutError(tx) {
  const relations = await tx`
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
      AND has_table_privilege('anon', c.oid, 'SELECT') AND ${ours(tx)}
    ORDER BY c.relname`;
  for (const { relname } of relations) {
    try {
      await asAnon(tx, (sp) => sp`SELECT count(*) FROM ${sp(relname)}`);
    } catch (error) {
      failures.push(`anon cannot read ${relname}: ${error.message}`);
    }
  }
  return relations.length;
}

async function seededRowsSplit(tx) {
  for (const verdict of VERDICTS) {
    const { table, visible, hidden } = verdict;
    try {
      const seen = await asAnon(tx, (sp) => seenKeys(sp, verdict));
      const missing = visible.filter((k) => !seen.has(k));
      const leaked = hidden.filter((k) => seen.has(k));
      if (missing.length > 0)
        failures.push(`anon cannot see ${table} ${missing.join(', ')}, which is public`);
      if (leaked.length > 0)
        failures.push(`anon sees ${table} ${leaked.join(', ')}, which is not public`);
    } catch (error) {
      failures.push(`anon read of ${table} failed: ${error.message}`);
    }
  }
}

async function viewsRunAsCaller(tx) {
  const views = await tx`
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v' AND ${ours(tx)}
      AND NOT EXISTS (SELECT 1 FROM unnest(c.reloptions) o WHERE o IN ('security_invoker=on', 'security_invoker=true'))
    ORDER BY c.relname`;
  for (const { relname } of views) {
    failures.push(
      `view ${relname} runs as its owner (no security_invoker): it ignores RLS for every caller`,
    );
  }
}

try {
  let relations = 0;
  // One transaction, always rolled back: the seed (a super admin among it) never outlives the probe,
  // whatever database DATABASE_URL names.
  await rolledBack(() =>
    sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '20s'`;
      await tx.unsafe(readFileSync(seedPath, 'utf8'));
      await seededRowsExist(tx);
      relations = await readsWithoutError(tx);
      await seededRowsSplit(tx);
      await viewsRunAsCaller(tx);
      throw ROLLBACK;
    }),
  );
  if (failures.length > 0) {
    console.error(`RLS probe FAILED (${failures.length}):\n  - ${failures.join('\n  - ')}`);
    process.exitCode = 1;
  } else {
    console.log(
      `RLS probe passed: no read errored for anon across ${relations} relations (a policy runs only over rows present: the seed's and the migrations'), ${VERDICTS.length} seeded tables split as expected, every view runs as its caller.`,
    );
  }
} catch (error) {
  console.error(`RLS probe could not run: ${error.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
