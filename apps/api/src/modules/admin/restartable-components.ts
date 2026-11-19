/**
 * UI key → docker-compose service name for every container the platform may start or restart:
 * the System Versions screen's buttons and the ops agent's door. Mirrors `RESTARTABLE_SERVICES` in
 * `infra/ops-runner/container-actions.mjs`; `container-actions.test.mjs` holds the two equal (it
 * imports this file, which therefore imports nothing). Anything not here is refused by the API and
 * by the runner, whatever the caller sent.
 *
 * Catastrophic / self-referential services are excluded on purpose:
 *   - `api`        — would kill the request mid-flight
 *   - `db`         — full data outage
 *   - `traefik`    — lose all HTTPS routing (renewal restarts it through its own route)
 *   - `ops-runner` — lose the channel that would restart anything else
 */
export const RESTARTABLE_COMPONENTS: Readonly<Record<string, string>> = {
  worker: 'worker',
  'web-admin': 'web-admin',
  'web-public': 'web-public',
  'web-staff': 'web-staff',
  'web-marketing': 'web-marketing',
  redis: 'redis',
  supabaseAuth: 'supabase-auth',
  supabaseRealtime: 'supabase-realtime',
  supabaseStorage: 'supabase-storage',
  postgrest: 'supabase-rest',
  supabaseMeta: 'supabase-meta',
  supabaseStudio: 'supabase-studio',
};
