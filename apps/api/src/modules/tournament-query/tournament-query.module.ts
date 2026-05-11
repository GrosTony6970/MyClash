import { Module } from '@nestjs/common';
import { AIUsageModule } from '../ai-usage/ai-usage.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { TournamentQueryController } from './tournament-query.controller';
import { TournamentQueryService } from './tournament-query.service';
import { TournamentQueryToolsService } from './tournament-query.tools.service';

@Module({
  imports: [SupabaseModule, OrganizationsModule, AIUsageModule],
  controllers: [TournamentQueryController],
  providers: [TournamentQueryService, TournamentQueryToolsService],
  exports: [TournamentQueryService],
})
export class TournamentQueryModule {}
