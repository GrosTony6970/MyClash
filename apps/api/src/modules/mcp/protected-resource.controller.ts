import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/public.decorator';
import { MCP_SCOPES, mcpUrls } from './mcp-urls';

/**
 * The OAuth protected-resource metadata (RFC 9728) Claude reads, with no token, before it
 * signs a person in. Served at the root of `api.${DOMAIN}` (see `API_GLOBAL_PREFIX_EXCLUDE`),
 * both at the path-aware address and at the bare one.
 */
@ApiTags('mcp')
@Public()
@Controller()
export class ProtectedResourceController {
  constructor(private readonly config: ConfigService) {}

  @Get('.well-known/oauth-protected-resource/api/v1/mcp')
  @ApiOperation({ summary: 'OAuth protected-resource metadata of the MCP door (RFC 9728)' })
  pathAware() {
    return this.document();
  }

  @Get('.well-known/oauth-protected-resource')
  @ApiOperation({ summary: 'OAuth protected-resource metadata, at the origin root (RFC 9728)' })
  root() {
    return this.document();
  }

  private document() {
    const urls = mcpUrls({
      DOMAIN: this.config.getOrThrow<string>('DOMAIN'),
      SUPABASE_URL: this.config.getOrThrow<string>('SUPABASE_URL'),
    });
    return {
      resource: urls.resource,
      authorization_servers: [urls.authorizationServer],
      scopes_supported: [...MCP_SCOPES],
      bearer_methods_supported: ['header'],
    };
  }
}
