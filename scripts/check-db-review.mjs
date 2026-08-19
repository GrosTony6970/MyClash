/**
 * The database review gate: RLS on every new table, and the schema invariants
 * around it.
 *
 * ── What `scanned` can and cannot do here ───────────────────────────────────
 * `scanned` is the number of migration files read. The harness's empty-scan
 * check cannot actually fire on this gate — with no migrations at all, the
 * required-extension and required-helper rules below already produce seven
 * errors, and an empty scan is deliberately not allowed to replace real
 * findings. The count is still reported, because a run that reviewed 40
 * migrations must not read like a run that reviewed 177.
 *
 * The floor that does the work is `checkUnappliedSqlFiles`. scripts/lib/
 * migrations.mjs names the hazard in its own docstring: "a filter that silently
 * skips files still prints success, just with a smaller N that nobody is
 * checking against." So any .sql sitting in the migrations directory that the
 * four-digit pattern rejects is an error — packages/db/scripts/migrate.mjs will
 * never apply it, and this gate would never review it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { defineGate } from './lib/gate.mjs';
import {
  objectName,
  securityDefinerFunctionsReachableByAnon,
  tablesMissingRls,
  viewsMissingSecurityInvoker,
} from './lib/db-rules.mjs';
import { MIGRATION_FILE_PATTERN, listMigrationFiles } from './lib/migrations.mjs';
import { stripSqlComments } from './lib/sql.mjs';

// Re-exported so scripts/check-db-review.test.mjs keeps importing them from the
// path it always did. That file is the regression proof for this refactor and
// must stay byte-identical; see scripts/lib/db-rules.mjs for why they moved.
export { securityDefinerFunctionsReachableByAnon, tablesMissingRls, viewsMissingSecurityInvoker };

const root = process.cwd();
const migrationsDir = join(root, 'packages', 'db', 'migrations');
const productionMigrationScriptPath = join(root, 'packages', 'db', 'scripts', 'migrate.mjs');
const matchAutoLockServicePath = join(
  root,
  'apps',
  'api',
  'src',
  'modules',
  'matches',
  'match-auto-lock.service.ts',
);
const fixtureSchemaReferenceFiles = [
  'packages/db/fixtures/phase4_synthetic.sql',
  'scripts/db-synthetic-fixture.mjs',
];
const requiredFiles = [
  'docs/DATABASE_REVIEW.md',
  'packages/db/fixtures/phase4_synthetic.sql',
  'packages/db/fixtures/phase4_explain.sql',
  'scripts/replay-db-migrations.mjs',
  'scripts/db-synthetic-fixture.mjs',
  'scripts/db-explain-report.mjs',
];

/** A warning is reported but does not fail the build; anything else does. */
const warn = (message) => ({ level: 'warn', message });

export function loadMigrationCorpus(dir = migrationsDir) {
  const files = listMigrationFiles(dir);
  const byFile = new Map(files.map((file) => [file, readFileSync(join(dir, file), 'utf8')]));
  const allSql = stripSqlComments([...byFile.values()].join('\n'));
  return { files, byFile, allSql };
}

export function checkRequiredArtifacts(names = requiredFiles) {
  return names
    .filter((file) => !statSync(join(root, file), { throwIfNoEntry: false }))
    .map((file) => `Missing required Phase 4 artifact: ${file}`);
}

/**
 * A .sql the runner will never apply, and this gate would never review.
 *
 * The corpus is a readdir plus a regex, with no floor under it. A file named
 * `186_x.sql` or `0186-x.sql` is skipped in silence by both this gate and
 * packages/db/scripts/migrate.mjs, so a CREATE TABLE inside it ships without
 * anyone checking it for RLS.
 */
export function checkUnappliedSqlFiles(dir = migrationsDir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql') && !MIGRATION_FILE_PATTERN.test(name))
    .map(
      (name) =>
        `${name} sits in packages/db/migrations but does not match ${MIGRATION_FILE_PATTERN.source}, ` +
        'so migrate.mjs never applies it and this gate never reviews it. ' +
        'Rename it to NNNN_name.sql, or move it out of the migrations directory.',
    );
}

export function checkMigrationOrdering(files) {
  const findings = [];
  const prefixes = files.map((file) => Number(file.slice(0, 4)));
  const duplicates = prefixes.filter((prefix, index) => prefixes.indexOf(prefix) !== index);
  if (duplicates.length > 0) {
    findings.push(`Duplicate migration prefixes: ${[...new Set(duplicates)].join(', ')}`);
  }
  for (let i = 1; i < prefixes.length; i += 1) {
    if ((prefixes[i] ?? 0) <= (prefixes[i - 1] ?? 0)) {
      findings.push(
        `Migration ordering is not strictly ascending around ${files[i - 1]} / ${files[i]}`,
      );
    }
  }
  return findings;
}

export function checkSchemaSecurity(allSql) {
  const findings = [];
  const missingRls = tablesMissingRls(allSql);
  if (missingRls.length > 0) {
    findings.push(`Tables without ENABLE ROW LEVEL SECURITY: ${missingRls.join(', ')}`);
  }
  const missingInvoker = viewsMissingSecurityInvoker(allSql);
  if (missingInvoker.length > 0) {
    findings.push(
      `Views without security_invoker = on run as their owner and ignore RLS on every base table: ${missingInvoker.join(', ')}`,
    );
  }
  const anonReachableDefiners = securityDefinerFunctionsReachableByAnon(allSql);
  if (anonReachableDefiners.length > 0) {
    findings.push(
      `SECURITY DEFINER functions must REVOKE EXECUTE FROM anon, authenticated by name (REVOKE ... FROM public does not remove the image's default grants): ${anonReachableDefiners.join(', ')}`,
    );
  }
  return findings;
}

export function checkIdempotency(allSql) {
  const findings = [];
  const tables = [
    ...allSql.matchAll(/CREATE TABLE\s+(?!IF NOT EXISTS)((?:"?\w+"?\.)?"?\w+"?)/gi),
  ].map((match) => objectName(match[1] ?? ''));
  if (tables.length > 0) {
    findings.push(
      warn(
        `Existing tables without IF NOT EXISTS should be reviewed before replay: ${tables.join(', ')}`,
      ),
    );
  }
  const indexes = [
    ...allSql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF NOT EXISTS)([\w"]+)/gi),
  ].map((match) => match[1]?.replaceAll('"', '') ?? '');
  if (indexes.length > 0) {
    findings.push(
      warn(
        `Existing indexes without IF NOT EXISTS should be reviewed before replay: ${indexes.join(', ')}`,
      ),
    );
  }
  return findings;
}

export function checkConstraintHygiene(allSql) {
  const findings = [];
  const inlineExpressionUniques = allSql
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(
      (line) =>
        /^UNIQUE\s*(?:NULLS\s+NOT\s+DISTINCT\s*)?\(/iu.test(line) &&
        /\b(?:lower|upper|unaccent|regexp_replace|coalesce|concat)\s*\(/iu.test(line),
    );
  if (inlineExpressionUniques.length > 0) {
    findings.push(
      `Inline UNIQUE constraints must not contain expressions; use a unique index instead: ${inlineExpressionUniques.join('; ')}`,
    );
  }

  const rawUnaccent = [];
  for (const match of allSql.matchAll(
    /CREATE\s+(?:UNIQUE\s+)?INDEX[\s\S]*?;\s*(?=(?:CREATE|ALTER|DROP|DO|INSERT|--|$))/giu,
  )) {
    const definition = match[0] ?? '';
    if (/\bunaccent\s*\(/iu.test(definition) && !/\bimmutable_unaccent\s*\(/iu.test(definition)) {
      rawUnaccent.push(definition.replace(/\s+/g, ' ').trim());
    }
  }
  if (rawUnaccent.length > 0) {
    findings.push(
      `Index expressions must use public.immutable_unaccent(...), not raw unaccent(...): ${rawUnaccent.join('; ')}`,
    );
  }
  return findings;
}

export function checkRequiredHelpers(allSql) {
  const findings = [];
  for (const extension of ['uuid-ossp', 'pg_trgm', 'unaccent', 'pg_stat_statements']) {
    if (!new RegExp(`CREATE EXTENSION IF NOT EXISTS\\s+"?${extension}"?`, 'i').test(allSql)) {
      findings.push(`Missing required extension migration: ${extension}`);
    }
  }
  for (const [name, pattern] of [
    ['auth.jwt()', /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+auth\.jwt\s*\(\s*\)/iu],
    ['auth.uid()', /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+auth\.uid\s*\(\s*\)/iu],
  ]) {
    if (!pattern.test(allSql)) {
      findings.push(`Missing self-hosted Supabase compatibility helper: ${name}.`);
    }
  }
  if (!/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.immutable_unaccent\s*\(/iu.test(allSql)) {
    findings.push(
      'Missing public.immutable_unaccent(TEXT) helper for indexed unaccent expressions.',
    );
  }
  return findings;
}

const fightersTableReferencePattern =
  /\b(?:FROM|JOIN)\s+(?:(?:"?public"?\.)?)"?fighters"?\b|\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:(?:"?public"?\.)?)"?fighters"?\b|\bREFERENCES\s+(?:(?:"?public"?\.)?)"?fighters"?\b|\b(?:CREATE|DROP)\s+POLICY\b[\s\S]*?\bON\s+(?:(?:"?public"?\.)?)"?fighters"?\b/iu;

// 0185 renamed league_rankings.fighter_id and league_tournament_results.fighter_id
// to global_person_id: both are FKs to global_persons, so the old name denoted the
// competing role while the value is a cross-event identity (docs/decisions/ADR-013).
// Nothing else enforces that, and the last time this drifted it went unnoticed for
// three months, so a later migration reintroducing the old column name fails here.
const leagueFighterColumnPattern =
  /\b(?:league_rankings|league_tournament_results)\b[\s\S]{0,400}?(?<!global_)\bfighter_id\b/iu;

export function checkRenamedReferences(files, byFile) {
  const findings = [];
  const uncommented = (file) => (byFile.get(file) ?? '').replace(/--.*$/gmu, '');
  const after = (prefix) => files.filter((name) => Number(name.slice(0, 4)) > prefix);

  const clubLookup = byFile.get('0026_club_lookup_with_abv.sql') ?? '';
  if (
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+find_club_by_name\s*\(\s*search_name\s+TEXT\s*,\s*threshold\s+FLOAT/iu.test(
      clubLookup,
    ) &&
    !/DROP\s+FUNCTION\s+IF\s+EXISTS\s+find_club_by_name\s*\(\s*TEXT\s*,\s*FLOAT\s*\)/iu.test(
      clubLookup,
    )
  ) {
    findings.push(
      '0026_club_lookup_with_abv.sql must drop find_club_by_name(TEXT, FLOAT) before changing its return table shape.',
    );
  }

  for (const file of after(23)) {
    if (fightersTableReferencePattern.test(uncommented(file))) {
      findings.push(
        `${file} references fighters as a table after 0023_global_persons.sql renames it to global_persons.`,
      );
    }
  }
  for (const file of after(185)) {
    if (leagueFighterColumnPattern.test(uncommented(file))) {
      findings.push(
        `${file} names fighter_id on a league table; 0185 renamed it to global_person_id.`,
      );
    }
  }
  return findings;
}

const staleFixtureFightersTablePattern =
  /\b(?:DELETE\s+FROM|INSERT\s+INTO|UPDATE|FROM|JOIN|REFERENCES)\s+(?:(?:"?public"?\.)?)"?fighters"?\b/iu;

export function checkFixtureSchema(
  names = fixtureSchemaReferenceFiles,
  read = (file) => readFileSync(join(root, file), 'utf8'),
) {
  const findings = [];
  for (const file of names) {
    const content = read(file);
    if (staleFixtureFightersTablePattern.test(content)) {
      findings.push(`${file} must use global_persons, not the renamed fighters table.`);
    }
    if (/\bglobal_fighter_id\b/iu.test(content)) {
      findings.push(`${file} must use persons.global_person_id, not global_fighter_id.`);
    }
  }
  return findings;
}

export function checkProductionRunner(
  script = readFileSync(productionMigrationScriptPath, 'utf8'),
  matchAutoLock = readFileSync(matchAutoLockServicePath, 'utf8'),
) {
  const findings = [];
  if (/drizzle-orm\/.*migrator/u.test(script)) {
    findings.push('Production migration script must not use Drizzle migrator metadata.');
  }
  for (const expected of [
    'myclash_schema_migrations',
    'checksum_sha256',
    'pg_advisory_lock',
    'pg_advisory_unlock',
    'onnotice: handleNotice',
    'already exists, skipping',
    'does not exist, skipping',
    'Suppressed ${suppressedNoticeCount} expected PostgreSQL notices.',
  ]) {
    if (!script.includes(expected)) {
      findings.push(`Production migration script is missing ${expected}.`);
    }
  }
  if (!/function\s+handleNotice\s*\(/u.test(script)) {
    findings.push('Production migration script must define an explicit PostgreSQL notice handler.');
  }
  if (/onnotice\s*:\s*console\.log/u.test(script)) {
    findings.push(
      'Production migration script must not dump raw PostgreSQL notices with console.log.',
    );
  }
  if (!/console\.warn\(`Notice\$\{code\}: \$\{message\}`\)/u.test(script)) {
    findings.push(
      'Production migration script must print unexpected PostgreSQL notices compactly.',
    );
  }

  if (/phases\s*\([^)]*matches\s*\(/u.test(matchAutoLock.replace(/\s+/gu, ' '))) {
    findings.push(
      'MatchAutoLockService must not rely on a nested phases(...matches(...)) PostgREST embed; matches.phase_id is not exposed as a schema-cache relationship.',
    );
  }
  return findings;
}

export function checkForeignKeyIndexes(allSql) {
  const fkColumns = [
    ...allSql.matchAll(/^\s+([a-zA-Z_]\w*_id)\s+UUID\s+(?:NOT NULL\s+)?REFERENCES/gim),
  ].map((match) => match[1] ?? '');
  const indexed = new Set(
    [...allSql.matchAll(/ON\s+\w+\s*\(([^)]+)\)/gi)]
      .flatMap((match) => (match[1] ?? '').split(','))
      .map((column) => column.trim().split(/\s+/)[0]?.replaceAll('"', '') ?? ''),
  );
  const unindexed = [...new Set(fkColumns.filter((column) => !indexed.has(column)))];
  if (unindexed.length === 0) return [];
  return [warn(`Foreign-key column names needing manual index review: ${unindexed.join(', ')}`)];
}

export const gate = defineGate({
  name: 'Database review',
  entry: import.meta.url,
  run: () => {
    const { files, byFile, allSql } = loadMigrationCorpus();
    const tables = [
      ...allSql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?((?:"?\w+"?\.)?"?\w+"?)/gi),
    ].length;
    const rlsTables = [
      ...allSql.matchAll(/ALTER TABLE\s+((?:"?\w+"?\.)?"?\w+"?)\s+ENABLE ROW LEVEL SECURITY/gi),
    ].length;

    return {
      findings: [
        ...checkRequiredArtifacts(),
        ...checkUnappliedSqlFiles(),
        ...checkMigrationOrdering(files),
        ...checkSchemaSecurity(allSql),
        ...checkIdempotency(allSql),
        ...checkConstraintHygiene(allSql),
        ...checkRequiredHelpers(allSql),
        ...checkRenamedReferences(files, byFile),
        ...checkFixtureSchema(),
        ...checkProductionRunner(),
        ...checkForeignKeyIndexes(allSql),
      ],
      scanned: files.length,
      summary:
        `Reviewed ${files.length} migrations and ${tables} table declarations; ` +
        `RLS enabled for ${rlsTables} table declarations.\n` +
        `  Review artifacts present: ${requiredFiles.join(', ')}.`,
      remedy:
        'Every new table needs an RLS policy in the same migration — without RLS a table is\n' +
        'world-readable, because PostgREST exposes the public schema as anon. A view needs\n' +
        'security_invoker = on, and a SECURITY DEFINER function needs EXECUTE revoked from\n' +
        'anon and authenticated BY NAME; revoking from PUBLIC leaves the image default grants.',
    };
  },
});
