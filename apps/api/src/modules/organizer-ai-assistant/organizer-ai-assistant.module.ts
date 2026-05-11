import { Module } from '@nestjs/common';
import { AIUsageModule } from '../ai-usage/ai-usage.module';
import { EventsModule } from '../events/events.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PhasesModule } from '../phases/phases.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { OrganizerAIAssistantController } from './organizer-ai-assistant.controller';
import { OrganizerAIAssistantService } from './organizer-ai-assistant.service';

@Module({
  imports: [SupabaseModule, AIUsageModule, OrganizationsModule, EventsModule, PhasesModule],
  controllers: [OrganizerAIAssistantController],
  providers: [OrganizerAIAssistantService],
  exports: [OrganizerAIAssistantService],
})
export class OrganizerAIAssistantModule {}
