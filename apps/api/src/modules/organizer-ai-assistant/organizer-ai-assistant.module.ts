import { Module } from '@nestjs/common';
import { AIUsageModule } from '../ai-usage/ai-usage.module';
import { EventsModule } from '../events/events.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PhasesModule } from '../phases/phases.module';
import { MatchPlacementModule } from '../matches/match-placement.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { OrganizerAIAssistantController } from './organizer-ai-assistant.controller';
import { OrganizerAIAssistantService } from './organizer-ai-assistant.service';

@Module({
  // The placement LEAF: `schedule_match` puts a bout on a piste, and that door
  // belongs to `MatchPlacementService` like every other. It owes the fighters'
  // alerts a refresh too, which the placement service does for it.
  imports: [
    SupabaseModule,
    AIUsageModule,
    OrganizationsModule,
    EventsModule,
    PhasesModule,
    MatchPlacementModule,
  ],
  controllers: [OrganizerAIAssistantController],
  providers: [OrganizerAIAssistantService],
  exports: [OrganizerAIAssistantService],
})
export class OrganizerAIAssistantModule {}
