import { Module } from '@nestjs/common';
import { NotificationSchedulingModule } from '../notifications/notification-scheduling.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { FightBookBlocksService } from './fightbook-blocks.service';
import { FightBookAfterController } from './fightbook-after.controller';
import { FightBookFavouritesService } from './fightbook-favourites.service';
import { FightBookController } from './fightbook.controller';
import { FightBookFloorController } from './fightbook-floor.controller';
import { FreeNowService } from './free-now.service';
import { OpenCallsService } from './open-calls.service';
import { FightBookSettingsService } from './fightbook-settings.service';
import { SparAfterService } from './spar-after.service';
import { ClubSparFlagsController, PlatformSparFlagsController } from './spar-flag-admin.controller';
import { SparFlagAdminService } from './spar-flag-admin.service';
import { SparFlagService } from './spar-flag.service';
import { SparFindService } from './spar-find.service';
import { SparReadsService } from './spar-reads.service';
import { SparRequestsService } from './spar-requests.service';
import { SparThanksService } from './spar-thanks.service';

/**
 * FightBook. NotificationSchedulingModule is a leaf (it imports only its own queue), and
 * OrganizationsModule imports only UserDirectoryModule and PrivacyModule (its club check tells
 * `hiddenEntrantIds` who is an insider), so neither edge can close a module cycle
 * (module-graph.test.ts).
 */
@Module({
  imports: [NotificationSchedulingModule, OrganizationsModule],
  controllers: [
    FightBookController,
    FightBookFloorController,
    FightBookAfterController,
    ClubSparFlagsController,
    PlatformSparFlagsController,
  ],
  providers: [
    FightBookSettingsService,
    SparRequestsService,
    SparReadsService,
    FightBookBlocksService,
    SparFindService,
    SparAfterService,
    SparFlagService,
    SparFlagAdminService,
    SparThanksService,
    FightBookFavouritesService,
    FreeNowService,
    OpenCallsService,
  ],
})
export class FightBookModule {}
