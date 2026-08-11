import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

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

function normalize(path) {
  return relative(root, path).split(sep).join('/');
}

function migrationFiles() {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
}

function objectName(matchValue) {
  return matchValue.split('.').pop()?.replaceAll('"', '') ?? matchValue;
}

// Migration headers in this repo are long prose, and they quote the DDL they
// discuss. Every structural check below would otherwise read those sentences
// as declarations: a header explaining `CREATE TABLE IF NOT EXISTS` reports a
// table named "IF" with no RLS. Blank the comments out rather than deleting
// them so line-keyed output stays honest.
export function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/--[^\n]*/g, (line) => ' '.repeat(line.length));
}

// The IF NOT EXISTS clause is optional on purpose. Requiring it hid 17 table
// declarations from this check, and event_hidden_skills (0076) shipped
// world-readable for that reason alone — see 0184.
export function tablesMissingRls(sql) {
  const tables = [
    ...sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?((?:"?\w+"?\.)?"?\w+"?)/gi),
  ].map((match) => objectName(match[1] ?? ''));
  const enabled = [
    ...sql.matchAll(/ALTER TABLE\s+((?:"?\w+"?\.)?"?\w+"?)\s+ENABLE ROW LEVEL SECURITY/gi),
  ].map((match) => objectName(match[1] ?? ''));
  return [...new Set(tables.filter((table) => !enabled.includes(table)))];
}

// RLS does not apply to views. A view with security_invoker off runs as its
// OWNER, and the migrating role is supabase_admin (SUPERUSER, BYPASSRLS), so
// such a view hands its base tables to any role that may SELECT it with RLS
// switched off entirely. Matched corpus-wide: a view may be created in one
// migration and pinned in a later one.
export function viewsMissingSecurityInvoker(sql) {
  const views = [
    ...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+((?:"?\w+"?\.)?"?\w+"?)/gi),
  ].map((match) => objectName(match[1] ?? ''));
  const pinned = [
    ...sql.matchAll(
      /ALTER\s+VIEW\s+((?:"?\w+"?\.)?"?\w+"?)\s+SET\s*\([^)]*security_invoker\s*=\s*on/gi,
    ),
    ...sql.matchAll(
      /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+((?:"?\w+"?\.)?"?\w+"?)\s+WITH\s*\([^)]*security_invoker\s*=\s*on/gi,
    ),
  ].map((match) => objectName(match[1] ?? ''));
  return [...new Set(views.filter((view) => !pinned.includes(view)))];
}

// SECURITY DEFINER functions must be revoked from anon and authenticated BY
// NAME. `REVOKE ... FROM public` looks equivalent and is not: the supabase
// image's ALTER DEFAULT PRIVILEGES grants EXECUTE to those two roles by name,
// and a role-specific grant survives a revoke aimed at PUBLIC. 0156, 0180 and
// 0182 all shipped believing otherwise.
export function securityDefinerFunctionsReachableByAnon(sql) {
  // Bounded at the body marker so a plain function cannot borrow the SECURITY
  // DEFINER of whichever function happens to be declared after it.
  const definers = [
    ...sql.matchAll(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:"?\w+"?\.)?"?\w+"?)\s*\(([\s\S]*?)AS\s*\$/gi,
    ),
  ]
    .filter((match) => /\bSECURITY\s+DEFINER\b/i.test(match[2] ?? ''))
    .map((match) => objectName(match[1] ?? ''));
  const revoked = new Set();
  for (const match of sql.matchAll(
    /REVOKE\s+[\s\S]*?\bON\s+FUNCTION\s+([\s\S]*?)\bFROM\b([^;]*);/gi,
  )) {
    const roles = match[2] ?? '';
    if (!/\banon\b/iu.test(roles) || !/\bauthenticated\b/iu.test(roles)) continue;
    for (const target of (match[1] ?? '').matchAll(/((?:"?\w+"?\.)?"?\w+"?)\s*\(/g)) {
      revoked.add(objectName(target[1] ?? ''));
    }
  }
  return [...new Set(definers.filter((fn) => !revoked.has(fn)))];
}

const files = migrationFiles();
const allSql = stripSqlComments(
  files.map((file) => readFileSync(join(migrationsDir, file), 'utf8')).join('\n'),
);
const migrationSqlByFile = new Map(
  files.map((file) => [file, readFileSync(join(migrationsDir, file), 'utf8')]),
);
const productionMigrationScript = readFileSync(productionMigrationScriptPath, 'utf8');
const matchAutoLockService = readFileSync(matchAutoLockServicePath, 'utf8');
const errors = [];
const warnings = [];

for (const file of requiredFiles) {
  const fullPath = join(root, file);
  if (!statSync(fullPath, { throwIfNoEntry: false })) {
    errors.push(`Missing required Phase 4 artifact: ${file}`);
  }
}

const prefixes = files.map((file) => Number(file.slice(0, 4)));
const duplicatePrefixes = prefixes.filter((prefix, index) => prefixes.indexOf(prefix) !== index);
if (duplicatePrefixes.length > 0) {
  errors.push(`Duplicate migration prefixes: ${[...new Set(duplicatePrefixes)].join(', ')}`);
}
for (let i = 1; i < prefixes.length; i += 1) {
  if ((prefixes[i] ?? 0) <= (prefixes[i - 1] ?? 0)) {
    errors.push(
      `Migration ordering is not strictly ascending around ${files[i - 1]} / ${files[i]}`,
    );
  }
}

const tables = [
  ...allSql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?((?:"?\w+"?\.)?"?\w+"?)/gi),
].map((match) => objectName(match[1] ?? ''));
const rlsTables = [
  ...allSql.matchAll(/ALTER TABLE\s+((?:"?\w+"?\.)?"?\w+"?)\s+ENABLE ROW LEVEL SECURITY/gi),
].map((match) => objectName(match[1] ?? ''));

const missingRls = tablesMissingRls(allSql);
if (missingRls.length > 0) {
  errors.push(`Tables without ENABLE ROW LEVEL SECURITY: ${missingRls.join(', ')}`);
}

const missingInvoker = viewsMissingSecurityInvoker(allSql);
if (missingInvoker.length > 0) {
  errors.push(
    `Views without security_invoker = on run as their owner and ignore RLS on every base table: ${missingInvoker.join(', ')}`,
  );
}

const anonReachableDefiners = securityDefinerFunctionsReachableByAnon(allSql);
if (anonReachableDefiners.length > 0) {
  errors.push(
    `SECURITY DEFINER functions must REVOKE EXECUTE FROM anon, authenticated by name (REVOKE ... FROM public does not remove the image's default grants): ${anonReachableDefiners.join(', ')}`,
  );
}

const nonIdempotentTables = [
  ...allSql.matchAll(/CREATE TABLE\s+(?!IF NOT EXISTS)((?:"?\w+"?\.)?"?\w+"?)/gi),
].map((match) => objectName(match[1] ?? ''));
if (nonIdempotentTables.length > 0) {
  warnings.push(
    `Existing tables without IF NOT EXISTS should be reviewed before replay: ${nonIdempotentTables.join(', ')}`,
  );
}

const nonIdempotentIndexes = [
  ...allSql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF NOT EXISTS)([\w"]+)/gi),
].map((match) => match[1]?.replaceAll('"', '') ?? '');
if (nonIdempotentIndexes.length > 0) {
  warnings.push(
    `Existing indexes without IF NOT EXISTS should be reviewed before replay: ${nonIdempotentIndexes.join(', ')}`,
  );
}

const inlineExpressionUniques = allSql
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter(
    (line) =>
      /^UNIQUE\s*(?:NULLS\s+NOT\s+DISTINCT\s*)?\(/iu.test(line) &&
      /\b(?:lower|upper|unaccent|regexp_replace|coalesce|concat)\s*\(/iu.test(line),
  );
if (inlineExpressionUniques.length > 0) {
  errors.push(
    `Inline UNIQUE constraints must not contain expressions; use a unique index instead: ${inlineExpressionUniques.join('; ')}`,
  );
}

for (const extension of ['uuid-ossp', 'pg_trgm', 'unaccent', 'pg_stat_statements']) {
  if (!new RegExp(`CREATE EXTENSION IF NOT EXISTS\\s+"?${extension}"?`, 'i').test(allSql)) {
    errors.push(`Missing required extension migration: ${extension}`);
  }
}
for (const [name, pattern] of [
  ['auth.jwt()', /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+auth\.jwt\s*\(\s*\)/iu],
  ['auth.uid()', /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+auth\.uid\s*\(\s*\)/iu],
]) {
  if (!pattern.test(allSql)) {
    errors.push(`Missing self-hosted Supabase compatibility helper: ${name}.`);
  }
}
if (!/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.immutable_unaccent\s*\(/iu.test(allSql)) {
  errors.push('Missing public.immutable_unaccent(TEXT) helper for indexed unaccent expressions.');
}
const rawUnaccentIndexExpressions = [];
const indexDefinitions = allSql.matchAll(
  /CREATE\s+(?:UNIQUE\s+)?INDEX[\s\S]*?;\s*(?=(?:CREATE|ALTER|DROP|DO|INSERT|--|$))/giu,
);
for (const match of indexDefinitions) {
  const definition = match[0] ?? '';
  if (/\bunaccent\s*\(/iu.test(definition) && !/\bimmutable_unaccent\s*\(/iu.test(definition)) {
    rawUnaccentIndexExpressions.push(definition.replace(/\s+/g, ' ').trim());
  }
}
if (rawUnaccentIndexExpressions.length > 0) {
  errors.push(
    `Index expressions must use public.immutable_unaccent(...), not raw unaccent(...): ${rawUnaccentIndexExpressions.join('; ')}`,
  );
}
const clubLookupWithAbv = migrationSqlByFile.get('0026_club_lookup_with_abv.sql') ?? '';
if (
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+find_club_by_name\s*\(\s*search_name\s+TEXT\s*,\s*threshold\s+FLOAT/iu.test(
    clubLookupWithAbv,
  ) &&
  !/DROP\s+FUNCTION\s+IF\s+EXISTS\s+find_club_by_name\s*\(\s*TEXT\s*,\s*FLOAT\s*\)/iu.test(
    clubLookupWithAbv,
  )
) {
  errors.push(
    '0026_club_lookup_with_abv.sql must drop find_club_by_name(TEXT, FLOAT) before changing its return table shape.',
  );
}
const fightersTableReferencePattern =
  /\b(?:FROM|JOIN)\s+(?:(?:"?public"?\.)?)"?fighters"?\b|\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:(?:"?public"?\.)?)"?fighters"?\b|\bREFERENCES\s+(?:(?:"?public"?\.)?)"?fighters"?\b|\b(?:CREATE|DROP)\s+POLICY\b[\s\S]*?\bON\s+(?:(?:"?public"?\.)?)"?fighters"?\b/iu;
for (const file of files.filter((name) => Number(name.slice(0, 4)) > 23)) {
  const sqlWithoutComments = (migrationSqlByFile.get(file) ?? '').replace(/--.*$/gmu, '');
  if (fightersTableReferencePattern.test(sqlWithoutComments)) {
    errors.push(
      `${file} references fighters as a table after 0023_global_persons.sql renames it to global_persons.`,
    );
  }
}
const staleFixtureFightersTablePattern =
  /\b(?:DELETE\s+FROM|INSERT\s+INTO|UPDATE|FROM|JOIN|REFERENCES)\s+(?:(?:"?public"?\.)?)"?fighters"?\b/iu;
for (const file of fixtureSchemaReferenceFiles) {
  const content = readFileSync(join(root, file), 'utf8');
  if (staleFixtureFightersTablePattern.test(content)) {
    errors.push(`${file} must use global_persons, not the renamed fighters table.`);
  }
  if (/\bglobal_fighter_id\b/iu.test(content)) {
    errors.push(`${file} must use persons.global_person_id, not global_fighter_id.`);
  }
}

if (/drizzle-orm\/.*migrator/u.test(productionMigrationScript)) {
  errors.push('Production migration script must not use Drizzle migrator metadata.');
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
  if (!productionMigrationScript.includes(expected)) {
    errors.push(`Production migration script is missing ${expected}.`);
  }
}
if (!/function\s+handleNotice\s*\(/u.test(productionMigrationScript)) {
  errors.push('Production migration script must define an explicit PostgreSQL notice handler.');
}
if (/onnotice\s*:\s*console\.log/u.test(productionMigrationScript)) {
  errors.push('Production migration script must not dump raw PostgreSQL notices with console.log.');
}
if (!/console\.warn\(`Notice\$\{code\}: \$\{message\}`\)/u.test(productionMigrationScript)) {
  errors.push('Production migration script must print unexpected PostgreSQL notices compactly.');
}
if (/phases\s*\([^)]*matches\s*\(/u.test(matchAutoLockService.replace(/\s+/gu, ' '))) {
  errors.push(
    'MatchAutoLockService must not rely on a nested phases(...matches(...)) PostgREST embed; matches.phase_id is not exposed as a schema-cache relationship.',
  );
}

const fkColumns = [
  ...allSql.matchAll(/^\s+([a-zA-Z_]\w*_id)\s+UUID\s+(?:NOT NULL\s+)?REFERENCES/gim),
].map((match) => match[1] ?? '');
const indexedColumns = new Set(
  [...allSql.matchAll(/ON\s+\w+\s*\(([^)]+)\)/gi)]
    .flatMap((match) => (match[1] ?? '').split(','))
    .map((column) => column.trim().split(/\s+/)[0]?.replaceAll('"', '') ?? ''),
);
const unindexedFkColumns = [...new Set(fkColumns.filter((column) => !indexedColumns.has(column)))];
if (unindexedFkColumns.length > 0) {
  warnings.push(
    `Foreign-key column names needing manual index review: ${unindexedFkColumns.join(', ')}`,
  );
}

// Reporting is guarded so the rule functions above can be imported by
// check-db-review.test.mjs without the import itself exiting the process.
const invokedDirectly = process.argv[1]?.endsWith('check-db-review.mjs');
if (invokedDirectly) {
  console.log(`Reviewed ${files.length} migrations and ${tables.length} table declarations.`);
  console.log(`RLS enabled for ${rlsTables.length} table declarations.`);
  if (warnings.length > 0) {
    console.warn('Database review warnings:');
    for (const warning of warnings) console.warn(`  - ${warning}`);
  }

  if (errors.length > 0) {
    console.error('Database review blockers:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  console.log(
    `Database review artifacts present: ${requiredFiles.map((file) => normalize(join(root, file))).join(', ')}`,
  );
}
