import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('DATABASE_URL is required to run database migrations.');
  process.exit(1);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(scriptDir, '..', 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
  .sort();

const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5, connect_timeout: 10 });

try {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('myclash_schema_migrations'))`;
    await tx`
      CREATE TABLE IF NOT EXISTS public.myclash_schema_migrations (
        filename TEXT PRIMARY KEY,
        checksum_sha256 TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await tx`ALTER TABLE public.myclash_schema_migrations ENABLE ROW LEVEL SECURITY`;

    const appliedRows = await tx`
      SELECT filename, checksum_sha256
      FROM public.myclash_schema_migrations
    `;
    const applied = new Map(appliedRows.map((row) => [row.filename, row.checksum_sha256]));

    let appliedCount = 0;
    let skippedCount = 0;

    for (const file of migrationFiles) {
      const migrationSql = readFileSync(join(migrationsDir, file), 'utf8');
      const checksum = createHash('sha256').update(migrationSql).digest('hex');
      const previousChecksum = applied.get(file);

      if (previousChecksum) {
        if (previousChecksum !== checksum) {
          throw new Error(
            `Migration checksum mismatch for ${file}. Applied=${previousChecksum} current=${checksum}`,
          );
        }
        console.log(`Skipping ${file} (already applied)`);
        skippedCount++;
        continue;
      }

      process.stdout.write(`Applying ${file}... `);
      await tx.unsafe(migrationSql);
      await tx`
        INSERT INTO public.myclash_schema_migrations (filename, checksum_sha256)
        VALUES (${file}, ${checksum})
      `;
      process.stdout.write('ok\n');
      appliedCount++;
    }

    console.log(
      `Migrations complete: ${appliedCount} applied, ${skippedCount} skipped, ${migrationFiles.length} total.`,
    );
  });
} finally {
  await sql.end();
}
