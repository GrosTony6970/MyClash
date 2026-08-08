/**
 * @myclash/db — migrations and the runner that applies them.
 *
 * This package has no TypeScript public API. It used to re-export a Drizzle
 * schema mirror of every table, which nothing ever imported: no app declared
 * `@myclash/db` as a dependency, and the schema had drifted from the SQL it
 * claimed to describe. Worse, `drizzle.config.ts` pointed `drizzle-kit
 * generate` at `out: './migrations'` — one command away from writing generated
 * SQL into the directory that IS the source of truth, keyed by a checksum that
 * `scripts/migrate.mjs` throws on when it changes.
 *
 * What the package actually is:
 *   migrations/        — the schema. Raw SQL, numbered, checksummed.
 *   scripts/migrate.mjs — applies them with `postgres`; deploy.sh runs this.
 *   test/rls.test.ts   — the RLS invariant (CLAUDE.md hard rule 4).
 *   fixtures/          — perf fixtures for db:perf:*.
 *
 * The barrel stays because `apps/api/Dockerfile` installs this package (so the
 * migration script and its SQL are in the image) and CI builds it — both of
 * which want a resolvable entry point. Query the database through PostgREST via
 * SupabaseService, or with raw SQL; there is no ORM here to reach for.
 */

export {};
