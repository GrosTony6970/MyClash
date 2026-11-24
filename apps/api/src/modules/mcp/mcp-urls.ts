/**
 * The MCP door's addresses, in one place. Claude adds the connector with `resource`, reads the
 * document at `resourceMetadata` (RFC 9728) and learns from it where to sign in
 * (`authorizationServer`, the sign-in server behind `SUPABASE_URL`).
 */

export interface McpUrls {
  /** The connector address a person pastes into Claude. */
  resource: string;
  /** Where Claude reads the resource metadata. */
  resourceMetadata: string;
  /** The sign-in server that mints the connector's token. */
  authorizationServer: string;
}

/** The resource metadata, at the path-aware address (RFC 9728) and at the root as a fallback. */
export const PROTECTED_RESOURCE_PATHS = [
  '.well-known/oauth-protected-resource/api/v1/mcp',
  '.well-known/oauth-protected-resource',
] as const;

export const MCP_SCOPES = ['email', 'profile', 'offline_access'] as const;

export function mcpUrls(env: { DOMAIN: string; SUPABASE_URL: string }): McpUrls {
  const api = `https://api.${env.DOMAIN}`;
  return {
    resource: `${api}/api/v1/mcp`,
    resourceMetadata: `${api}/${PROTECTED_RESOURCE_PATHS[0]}`,
    authorizationServer: `${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1`,
  };
}
