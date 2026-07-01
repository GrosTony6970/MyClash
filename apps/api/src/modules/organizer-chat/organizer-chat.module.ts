import { Module } from '@nestjs/common';
import { AIUsageModule } from '../ai-usage/ai-usage.module';
import { AdminFeatureFlagsService } from '../admin/admin-feature-flags.service';
import { OrganizationsModule } from '../organizations/organizations.module';
import { OrganizerAIAssistantModule } from '../organizer-ai-assistant/organizer-ai-assistant.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { OrganizerChatController } from './organizer-chat.controller';
import { OrganizerChatService } from './organizer-chat.service';
import { OrganizerChatToolsService } from './organizer-chat.tools.service';

@Module({
  imports: [SupabaseModule, AIUsageModule, OrganizationsModule, OrganizerAIAssistantModule],
  controllers: [OrganizerChatController],
  // AdminFeatureFlagsService only needs SupabaseService — provide it locally
  // (mirroring AIUsageModule) to gate on `disable_organizer_chat` without
  // importing the heavyweight AdminModule.
  providers: [OrganizerChatService, OrganizerChatToolsService, AdminFeatureFlagsService],
})
export class OrganizerChatModule {}
