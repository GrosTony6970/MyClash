import { Module } from '@nestjs/common';
import { NotificationSchedulingModule } from '../notifications/notification-scheduling.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { FightBookBlocksService } from './fightbook-blocks.service';
import { FightBookController } from './fightbook.controller';
import { FightBookSettingsService } from './fightbook-settings.service';
import { SparFindService } from './spar-find.service';
import { SparReadsService } from './spar-reads.service';
import { SparRequestsService } from './spar-requests.service';

/**
 * FightBook. NotificationSchedulingModule is a leaf (it imports only its own queue), and
 * OrganizationsModule imports only UserDirectoryModule and PrivacyModule (its club check tells
 * `hiddenEntrantIds` who is an insider), so neither edge can close a module cycle
 * (module-graph.test.ts).
 */
@Module({
  imports: [NotificationSchedulingModule, OrganizationsModule],
  controllers: [FightBookController],
  providers: [
    FightBookSettingsService,
    SparRequestsService,
    SparReadsService,
    FightBookBlocksService,
    SparFindService,
  ],
})
export class FightBookModule {}
