/**
 * The containers whose log the ops agent may read (ruling 869): every compose service but `db`
 * and `supabase-meta`. The database's log can carry the values of a SQL statement, and meta logs
 * a failed query's Postgres error with its DETAIL ("Failing row contains (…)": a whole row, a birth
 * date included). A scrub cannot find a date, so neither log reaches the agent.
 *
 * The ops runner holds the same list (`LOG_SERVICES`, `infra/ops-runner/container-logs.mjs`);
 * `container-logs.test.mjs` holds the two equal, and holds them against the compose file. No
 * imports: that test loads this file on its own.
 */
export const AGENT_LOG_SERVICES = [
  'traefik',
  'redis',
  'supabase-auth',
  'supabase-realtime',
  'supabase-storage',
  'supabase-rest',
  'supabase-studio',
  'api',
  'ops-runner',
  'worker',
  'web-public',
  'web-marketing',
  'web-staff',
  'web-admin',
] as const;

export type AgentLogService = (typeof AGENT_LOG_SERVICES)[number];
