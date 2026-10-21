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
 * twelve checks, the reads as anon (JWT claims with no `sub`), each in a savepoint rolled back after
 * it; the whole run is one transaction, always rolled back, so nothing it wrote survives:
 *   1. every relation anon may SELECT (any column of it) answers without an error — a table whose
 *      grant is split per column is still read, so its policy is still evaluated;
 *   2. the seeded rows split exactly: the published Event's published Tournament is visible; the
 *      draft Event's side, a draft Tournament's side (even under the published Event), the private
 *      League, the club's own rulesets, the membership and the platform role are hidden;
 *   3. every PRIVATE_COLUMNS entry is granted to neither anon nor authenticated, and an anon read of
 *      it is refused (42501) — a column no policy can hide on a row it shows;
 *   4. every view in `public` runs as its caller (security_invoker) — the runtime twin of
 *      db:review's static rule, which missed 0193;
 *   5. every API_ONLY_WRITES table refuses the verbs of its entry on privilege (42501, not an RLS
 *      refusal) to the seeded organisation admin, signed in, and grants none of them to anon: only the
 *      API's service role writes it (0209, ruling 144; the League tables, 0216; club scoring
 *      rulesets, 0225; penalty rulesets, 0226; re-pin records, 0227; a bout's copies of its rules,
 *      0229; Tournaments, 0233; an Event's and a club's DELETE alone, 0237; a bout and what is
 *      recorded on it, a phase's and a Registration's DELETE alone, 0238;
 *      `lib/api-only-writes-probe.mjs`);
 *   6. a League is visible only when it is published (0215, ruling 88): the database refuses a
 *      visible draft, inserted or unpublished, so the anon League policies, which read
 *      `public_visibility` alone, match the API's bar;
 *   7. `account_emails` (0217) is refused to anon and to a signed-in user on privilege, and answers
 *      the service role for the accounts it asks for, no other (`lib/account-emails-probe.mjs`);
 *      checks 8 to 15 are listed with it in `lib/rls-probe-later-checks.mjs`.
 * Signed-in reads are out of scope: ruling 111a leaves their loop latent on purpose. Checks 5 and
 * 7 are a write and a function call, each refused on privilege before any policy runs. Check 10
 * moves an Event signed in past the policies, with the looping helpers made SECURITY DEFINER
 * inside its savepoint, to reach the 0224 Event-move trigger (`lib/ruleset-pair-probe.mjs`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';

import { apiOnlyWritesFailures } from './lib/api-only-writes-probe.mjs';
import { laterCheckFailures } from './lib/rls-probe-later-checks.mjs';
import { API_ONLY_WRITES, PRIVATE_COLUMNS, VERDICTS } from './lib/rls-probe-tables.mjs';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error(
    'DATABASE_URL is required and must point at a disposable, freshly replayed database (pnpm db:migrations:replay).',
  );
  process.exit(1);
}

const seedPath = join(process.cwd(), 'packages', 'db', 'fixtures', 'rls-probe-seed.sql');

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
      AND has_any_column_privilege('anon', c.oid, 'SELECT') AND ${ours(tx)}
    ORDER BY c.relname`;
  for (const { relname } of relations) {
    try {
      await asAnon(tx, (sp) => sp`SELECT count(*) FROM ${sp(relname)}`);
    } catch (error) {
      failures.push(`anon cannot read ${relname}: ${error.message}`);
    }
  }
  // A seeded table is public by design; if the privilege lookup lost it, check 1 skipped its policy.
  const read = new Set(relations.map((r) => r.relname));
  for (const { table } of VERDICTS) {
    if (!read.has(table))
      failures.push(`check 1 did not read ${table}: its policy went unevaluated`);
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

async function privateColumnsHidden(tx) {
  for (const { table, column } of PRIVATE_COLUMNS) {
    for (const role of ['anon', 'authenticated']) {
      const [{ granted }] =
        await tx`SELECT has_column_privilege(${role}, ${table}, ${column}, 'SELECT') AS granted`;
      if (granted) failures.push(`${role} may read ${table}.${column}, which is private`);
    }
    try {
      await asAnon(tx, (sp) => sp`SELECT ${sp(column)} FROM ${sp(table)} LIMIT 1`);
      failures.push(`anon read ${table}.${column}, which is private`);
    } catch (error) {
      if (error.code !== '42501')
        failures.push(
          `anon read of ${table}.${column} failed for another reason: ${error.message}`,
        );
    }
  }
}

/** The seeded public League (rls-probe-seed.sql). */
const PUBLIC_LEAGUE = '1eaa0000-0000-4000-8000-00000000000a';

/** Each write, as the owner in a rolled-back savepoint, must fail the 0215 CHECK (23514). */
async function visibleLeagueIsPublished(tx) {
  const writes = {
    'insert a visible draft': (sp) =>
      sp`INSERT INTO leagues (slug, name, season_year, status, public_visibility)
        VALUES ('rls-probe-visible-draft', 'Visible draft', 2026, 'draft', true)`,
    'unpublish a visible League': (sp) =>
      sp`UPDATE leagues SET status = 'draft' WHERE id = ${PUBLIC_LEAGUE}`,
  };
  for (const [label, write] of Object.entries(writes)) {
    let failure = null;
    await rolledBack(() =>
      tx.savepoint(async (sp) => {
        await write(sp).catch((error) => {
          failure = error;
        });
        throw ROLLBACK;
      }),
    );
    if (failure?.code !== '23514')
      failures.push(
        `leagues: ${label} was not refused by its CHECK: ${failure?.message ?? 'accepted'}`,
      );
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
      await privateColumnsHidden(tx);
      await viewsRunAsCaller(tx);
      failures.push(...(await apiOnlyWritesFailures(tx)));
      await visibleLeagueIsPublished(tx);
      failures.push(...(await laterCheckFailures(tx)));
      throw ROLLBACK;
    }),
  );
  if (failures.length > 0) {
    console.error(`RLS probe FAILED (${failures.length}):\n  - ${failures.join('\n  - ')}`);
    process.exitCode = 1;
  } else {
    console.log(
      `RLS probe passed: no read errored for anon across ${relations} relations (a policy runs only over rows present: the seed's and the migrations'), ${VERDICTS.length} seeded tables split as expected, ${PRIVATE_COLUMNS.length} private columns hidden from anon and authenticated, every view runs as its caller, ${API_ONLY_WRITES.length} tables refuse the direct writes only the API makes, a visible League is a published one, account addresses are read by the service role only, a push address has one account, an account holds one roster row at an Event, an Event moves only to a club its Tournaments' rulesets are offered to, a bout holds a copy of its own Tournament's rules, the programme moves only bouts that exist, an audited rules change writes only over what it read, the built-in penalty ruleset holds the FFAMHE forfeit rules, a forfeit has no winner exactly when it is a draw.`,
    );
  }
} catch (error) {
  console.error(`RLS probe could not run: ${error.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
