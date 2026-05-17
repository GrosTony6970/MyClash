import { Module } from '@nestjs/common';
import { WorkersModule } from '../../workers/workers.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { LeaguesModule } from '../leagues/leagues.module';
import { EventsController } from './events.controller';
import { EventThemesService } from './event-themes.service';
import { EventsService } from './events.service';

@Module({
  imports: [OrganizationsModule, WorkersModule, LeaguesModule],
  controllers: [EventsController],
  providers: [EventsService, EventThemesService],
  exports: [EventsService, EventThemesService],
})
export class EventsModule {}
