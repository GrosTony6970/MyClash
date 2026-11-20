import { AGENT_LOG_SERVICES } from './agent-log-services';

/**
 * Every compose service that runs all the time (ruling 900): the log services, plus `db` and
 * `supabase-meta`, whose logs the agent may not read (ruling 869). None is a one-off, so a service
 * with no container at all is a problem. The skill's §4 names the same list.
 */
export const EXPECTED_SERVICES: readonly string[] = [...AGENT_LOG_SERVICES, 'db', 'supabase-meta'];
