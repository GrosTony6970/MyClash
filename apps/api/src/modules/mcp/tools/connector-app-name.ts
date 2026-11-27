import { Logger } from '@nestjs/common';
import type { McpToolDeps } from '../mcp-server';

const logger = new Logger('ConnectorAppName');

/**
 * The connector app's name for an audit row (call L, ruling 990): the referee apply and the
 * draft tools. It is the name the app gave itself when it registered with the auth server: what
 * it calls itself, not a name we checked. A failed read leaves it null and the write goes on:
 * the person is the actor either way.
 */
export async function appName(deps: McpToolDeps, clientId: string): Promise<string | null> {
  try {
    const { data, error } = await deps.supabase.service.auth.admin.oauth.getClient(clientId);
    if (error) {
      logger.warn(`connector app name read failed: ${error.status ?? '-'} ${error.code ?? '-'}`);
      return null;
    }
    if (typeof data?.client_name !== 'string' || data.client_name === '') {
      logger.warn('connector app name read answered no client_name');
      return null;
    }
    return data.client_name;
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    logger.warn(`connector app name read threw: ${message}`);
    return null;
  }
}
