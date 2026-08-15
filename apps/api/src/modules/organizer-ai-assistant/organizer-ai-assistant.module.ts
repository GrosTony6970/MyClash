import { Module } from '@nestjs/common';
import { AIUsageModule } from '../ai-usage/ai-usage.module';
import { EventsModule } from '../events/events.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PhasesModule } from '../phases/phases.module';
import { NotificationSchedulingModule } from '../notifications/notification-scheduling.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { OrganizerAIAssistantController } from './organizer-ai-assistant.controller';
import { OrganizerAIAssistantService } from './organizer-ai-assistant.service';

@Module({
  // The notification LEAF: the `schedule_match` action writes a match time,
  // so it owes the alerts built from that time a refresh.
  imports: [
    SupabaseModule,
    AIUsageModule,
    OrganizationsModule,
    EventsModule,
    PhasesModule,
    NotificationSchedulingModule,
  ],
  controllers: [OrganizerAIAssistantController],
  providers: [OrganizerAIAssistantService],
  exports: [OrganizerAIAssistantService],
})
export class OrganizerAIAssistantModule {}
