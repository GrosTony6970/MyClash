/**
 * The clock every BullMQ job scheduler runs on: UTC (operator ruling 829).
 *
 * A cron `pattern` with no `tz` is read in the process's own time zone. Both roles run with
 * `TZ: ${TZ}` (Europe/Paris), so the night jobs whose comments said UTC ran one to two hours
 * early: the HEMA Ratings sync before the 03:00 UTC backup, the scans with it. Every scheduler
 * goes through `utcCron`, so a pattern means the same hour on every host and in every season.
 * The backup is not a BullMQ job: the ops runner keeps its own UTC slot (ruling 833).
 */
export const CRON_TZ = 'UTC';

/** A cron scheduler's repeat options, on the UTC clock. */
export function utcCron(pattern: string): { pattern: string; tz: typeof CRON_TZ } {
  return { pattern, tz: CRON_TZ };
}
