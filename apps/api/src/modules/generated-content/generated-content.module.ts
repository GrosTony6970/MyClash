import { Module } from '@nestjs/common';
import { AIProvidersModule } from '../ai-providers/ai-providers.module';
import { AIUsageModule } from '../ai-usage/ai-usage.module';
import { AdminFeatureFlagsService } from '../admin/admin-feature-flags.service';
import { EventsModule } from '../events/events.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { MemberStatsService } from '../directory-groups/member-stats.service';
import { CONTENT_TYPES } from './content-type.interface';
import {
  GeneratedContentController,
  PublicGeneratedContentController,
} from './generated-content.controller';
import { GeneratedContentService } from './generated-content.service';
import { MeAIController } from './me-ai.controller';
import { FighterInsightType } from './types/fighter-insight.type';
import { OrganizerContentType } from './types/organizer-content.type';
import { TournamentRecapType } from './types/tournament-recap.type';

@Module({
  imports: [SupabaseModule, AIUsageModule, AIProvidersModule, EventsModule, OrganizationsModule],
  controllers: [GeneratedContentController, PublicGeneratedContentController, MeAIController],
  providers: [
    GeneratedContentService,
    TournamentRecapType,
    OrganizerContentType,
    FighterInsightType,
    // Lightweight deps provided locally (only need SupabaseService), mirroring
    // how organizer-chat provides AdminFeatureFlagsService.
    MemberStatsService,
    AdminFeatureFlagsService,
    // Registry: every content-type def, collected for GeneratedContentService.
    {
      provide: CONTENT_TYPES,
      useFactory: (
        recap: TournamentRecapType,
        organizer: OrganizerContentType,
        insight: FighterInsightType,
      ) => [recap, organizer, insight],
      inject: [TournamentRecapType, OrganizerContentType, FighterInsightType],
    },
  ],
  exports: [GeneratedContentService],
})
export class GeneratedContentModule {}
