import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

import { listMigrationFiles } from './lib/migrations.mjs';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error(
    'DATABASE_URL is required and must point at a disposable database. Example: DATABASE_URL=postgres://postgres:dev-password@localhost:5432/myclash_phase4 pnpm db:migrations:replay',
  );
  process.exit(1);
}

const root = process.cwd();
const migrationsDir = join(root, 'packages', 'db', 'migrations');
// Supabase-compatibility baseline (roles + auth.users + auth.role()) so the
// replay works against a vanilla postgres image. Idempotent + non-destructive,
// so applying it against a real Supabase DB is a harmless no-op — see the file
// header and docs/DATABASE_REVIEW.md.
const baselinePath = join(root, 'packages', 'db', 'fixtures', 'supabase-baseline.sql');
const files = listMigrationFiles(migrationsDir);

const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5, connect_timeout: 10 });

try {
  if (existsSync(baselinePath)) {
    process.stdout.write('Applying Supabase baseline (roles + auth stubs)... ');
    await sql.unsafe(readFileSync(baselinePath, 'utf8'));
    process.stdout.write('ok\n');
  }
  for (const file of files) {
    const migrationSql = readFileSync(join(migrationsDir, file), 'utf8');
    process.stdout.write(`Applying ${file}... `);
    await sql.unsafe(migrationSql);
    process.stdout.write('ok\n');
  }
  console.log(`Fresh migration replay succeeded for ${files.length} migrations.`);
} finally {
  await sql.end();
}
