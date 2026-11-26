import { Module } from '@nestjs/common';
import { MeModule } from '../me/me.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ConnectedAppsController } from './connected-apps.controller';
import { ConnectedAppsService } from './connected-apps.service';
import { McpController } from './mcp.controller';
import { McpDoorGuard } from './mcp-door.guard';
import { OAuthConsentController } from './oauth-consent.controller';
import { OAuthConsentService } from './oauth-consent.service';
import { ProtectedResourceController } from './protected-resource.controller';

/** The MCP door: Claude's connector into MyClash, and the consent page's API that opens it. */
@Module({
  imports: [MeModule, OrganizationsModule],
  controllers: [
    ProtectedResourceController,
    McpController,
    OAuthConsentController,
    ConnectedAppsController,
  ],
  providers: [McpDoorGuard, OAuthConsentService, ConnectedAppsService],
})
export class McpModule {}
