import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { AIProvidersModule } from '../ai-providers/ai-providers.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AdminFeatureFlagsService } from '../admin/admin-feature-flags.service';
import { AIDashboardController } from './ai-dashboard.controller';
import { AIUsageController } from './ai-usage.controller';
import { AIUsageService } from './ai-usage.service';

@Module({
  imports: [SupabaseModule, AIProvidersModule, OrganizationsModule],
  controllers: [AIUsageController, AIDashboardController],
  // AdminFeatureFlagsService only depends on SupabaseService; provide it locally
  // (rather than importing the heavyweight AdminModule) to gate the org path on
  // the `disable_ai_features` flag without risking a circular module import.
  providers: [AIUsageService, AdminFeatureFlagsService],
  exports: [AIUsageService],
})
export class AIUsageModule {}
