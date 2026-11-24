import { describe, expect, it } from 'vitest';
import { MCP_SCOPES, PROTECTED_RESOURCE_PATHS, mcpUrls } from './mcp-urls';

describe('mcpUrls', () => {
  it('names the door, its metadata and the sign-in server, trimming the trailing slash', () => {
    expect(mcpUrls({ DOMAIN: 'myclash.fr', SUPABASE_URL: 'https://app.myclash.fr/' })).toEqual({
      resource: 'https://api.myclash.fr/api/v1/mcp',
      resourceMetadata: 'https://api.myclash.fr/.well-known/oauth-protected-resource/api/v1/mcp',
      authorizationServer: 'https://app.myclash.fr/auth/v1',
    });
  });

  it('gives the dev values on the localhost stack', () => {
    const urls = mcpUrls({
      DOMAIN: 'myclash.localhost',
      SUPABASE_URL: 'https://api.myclash.localhost',
    });
    expect(urls.authorizationServer).toBe('https://api.myclash.localhost/auth/v1');
    expect(urls.resource).toBe('https://api.myclash.localhost/api/v1/mcp');
  });

  it('pins the two metadata paths and the scopes', () => {
    expect(PROTECTED_RESOURCE_PATHS).toEqual([
      '.well-known/oauth-protected-resource/api/v1/mcp',
      '.well-known/oauth-protected-resource',
    ]);
    expect(MCP_SCOPES).toEqual(['email', 'profile', 'offline_access']);
  });
});
