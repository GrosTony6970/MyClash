import { Module } from '@nestjs/common';
import { WorkersModule } from '../../workers/workers.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { BroadcastNotificationsController } from './broadcast-notifications.controller';
import { BroadcastNotificationsService } from './broadcast-notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [SupabaseModule, OrganizationsModule, WorkersModule],
  controllers: [NotificationsController, BroadcastNotificationsController],
  providers: [NotificationsService, BroadcastNotificationsService],
  exports: [NotificationsService, BroadcastNotificationsService],
})
export class NotificationsModule {}
