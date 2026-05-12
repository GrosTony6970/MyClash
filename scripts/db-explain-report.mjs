import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error(
    'DATABASE_URL is required. Apply packages/db/fixtures/phase4_synthetic.sql to a disposable DB, then run pnpm db:perf:explain.',
  );
  process.exit(1);
}

const root = process.cwd();
const explainSql = readFileSync(
  join(root, 'packages', 'db', 'fixtures', 'phase4_explain.sql'),
  'utf8',
);
const statements = explainSql
  .split(/;\s*(?:\r?\n|$)/)
  .map((statement) => statement.trim())
  .map((statement) =>
    statement
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .trim(),
  )
  .filter((statement) => statement.startsWith('EXPLAIN'));

const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5, connect_timeout: 10 });

try {
  for (const [index, statement] of statements.entries()) {
    console.log(`\n-- Query ${index + 1}`);
    const rows = await sql.unsafe(statement);
    for (const row of rows) {
      console.log(row['QUERY PLAN']);
    }
  }
} finally {
  await sql.end();
}
