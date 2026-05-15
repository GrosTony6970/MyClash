import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const migrationsDir = join(root, 'packages', 'db', 'migrations');
const productionMigrationScriptPath = join(root, 'packages', 'db', 'scripts', 'migrate.mjs');
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

const files = migrationFiles();
const allSql = files.map((file) => readFileSync(join(migrationsDir, file), 'utf8')).join('\n');
const migrationSqlByFile = new Map(
  files.map((file) => [file, readFileSync(join(migrationsDir, file), 'utf8')]),
);
const productionMigrationScript = readFileSync(productionMigrationScriptPath, 'utf8');
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

const tables = [...allSql.matchAll(/CREATE TABLE IF NOT EXISTS\s+((?:"?\w+"?\.)?"?\w+"?)/gi)].map(
  (match) => objectName(match[1] ?? ''),
);
const rlsTables = [
  ...allSql.matchAll(/ALTER TABLE\s+((?:"?\w+"?\.)?"?\w+"?)\s+ENABLE ROW LEVEL SECURITY/gi),
].map((match) => objectName(match[1] ?? ''));

const missingRls = tables.filter((table) => !rlsTables.includes(table));
if (missingRls.length > 0) {
  errors.push(`Tables without ENABLE ROW LEVEL SECURITY: ${[...new Set(missingRls)].join(', ')}`);
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

if (/drizzle-orm\/.*migrator/u.test(productionMigrationScript)) {
  errors.push('Production migration script must not use Drizzle migrator metadata.');
}
for (const expected of [
  'myclash_schema_migrations',
  'checksum_sha256',
  'pg_advisory_lock',
  'pg_advisory_unlock',
]) {
  if (!productionMigrationScript.includes(expected)) {
    errors.push(`Production migration script is missing ${expected}.`);
  }
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
