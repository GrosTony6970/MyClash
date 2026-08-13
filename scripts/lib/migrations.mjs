import { readdirSync } from 'node:fs';

/**
 * Which files in packages/db/migrations are migrations, and in what order they
 * apply.
 *
 * ── Why this is shared ──────────────────────────────────────────────────────
 * The four-digit prefix is the apply order for all 175 migrations, and the
 * numbering is append-only: a prefix is never reused and an applied file is
 * never renumbered, because packages/db/scripts/migrate.mjs records a checksum
 * per name and throws when one moves.
 *
 * That contract was written out four separate times — in check-db-review.mjs,
 * check-realtime-bindings.mjs, replay-db-migrations.mjs, and in the production
 * runner itself. Three of those are gates, and a gate that disagrees with the
 * runner about which files count reports on a corpus the database never sees.
 *
 * replay-db-migrations.mjs is the one that matters most: it applies this list
 * to a real Postgres and prints "Fresh migration replay succeeded for N
 * migrations". A filter that silently skips files still prints success, just
 * with a smaller N that nobody is checking against.
 *
 * ── Why the production runner is not imported ───────────────────────────────
 * packages/db/scripts/migrate.mjs is copied into the API image and run there
 * (infra pins that path and asserts on it), so it cannot take a dependency on
 * the repo's root scripts/ directory. Instead the pattern is duplicated once,
 * deliberately, and migrations.test.mjs asserts the runner still spells it the
 * same way — the drift is made loud rather than prevented.
 */
export const MIGRATION_FILE_PATTERN = /^\d{4}_.+\.sql$/u;

/** Migration file names in apply order. Names only, not paths. */
export function listMigrationFiles(migrationsDir) {
  return readdirSync(migrationsDir)
    .filter((name) => MIGRATION_FILE_PATTERN.test(name))
    .sort();
}
