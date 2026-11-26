import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { FightersModule } from '../fighters/fighters.module';
import { MatchesModule } from '../matches/matches.module';
import { MeModule } from '../me/me.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PersonsModule } from '../persons/persons.module';
import { PoolStandingsModule } from '../pool-standings/pool-standings.module';
import { RefereesModule } from '../referees/referees.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { TournamentQueryModule } from '../tournament-query/tournament-query.module';
import { ConnectedAppsController } from './connected-apps.controller';
import { ConnectedAppsService } from './connected-apps.service';
import { McpController } from './mcp.controller';
import { McpDoorGuard } from './mcp-door.guard';
import { OAuthConsentController } from './oauth-consent.controller';
import { OAuthConsentService } from './oauth-consent.service';
import { ProtectedResourceController } from './protected-resource.controller';

/** The MCP door: Claude's connector into MyClash, and the consent page's API that opens it. */
@Module({
  imports: [
    EventsModule,
    FightersModule,
    MatchesModule,
    MeModule,
    OrganizationsModule,
    PersonsModule,
    PoolStandingsModule,
    RefereesModule,
    ScheduleModule,
    TournamentQueryModule,
  ],
  controllers: [
    ProtectedResourceController,
    McpController,
    OAuthConsentController,
    ConnectedAppsController,
  ],
  providers: [McpDoorGuard, OAuthConsentService, ConnectedAppsService],
})
export class McpModule {}
