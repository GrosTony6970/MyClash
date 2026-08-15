import { Module } from '@nestjs/common';
import { ProgrammeController } from './programme.controller';
import { ProgrammeService } from './programme.service';
import { OrganizationsModule } from '../organizations/organizations.module';
import { NotificationSchedulingModule } from '../notifications/notification-scheduling.module';

@Module({
  // OrganizationsModule imports only UserDirectoryModule + PrivacyModule, so
  // this edge cannot form a cycle.
  //
  // NotificationSchedulingModule is the notification LEAF, never WorkersModule:
  // five writes here move or clear a match's time and owe the alerts a refresh,
  // and WorkersModule reaches back into this half of the graph. The leaf has no
  // import edges that re-enter it — see its header for the cycle it was cut to
  // break. A cycle here shows up only when Nest actually instantiates, so this
  // edge is proved at real boot by module-graph.test.ts, not by `tsc`.
  imports: [OrganizationsModule, NotificationSchedulingModule],
  controllers: [ProgrammeController],
  providers: [ProgrammeService],
  exports: [ProgrammeService],
})
export class ProgrammeModule {}
