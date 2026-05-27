import { Module } from '@nestjs/common';
import { HemaRatingsModule } from '../hema-ratings/hema-ratings.module';
import { MatchesModule } from '../matches/matches.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SupabaseService } from '../supabase/supabase.service';
import { HemaRatingsAdminController } from './hema-ratings-admin.controller';
import { AIDataQualityController } from './ai-data-quality.controller';
import { AIDataQualityService } from './ai-data-quality.service';
import { AdminAuditLogService } from './admin-audit-log.service';
import { BackupsAdminController } from './backups.controller';
import { AdminBackupsService } from './backups.service';
import { AdminDashboardStatsService } from './admin-dashboard-stats.service';
import { AdminFeatureFlagsService } from './admin-feature-flags.service';
import { AdminOrganizationsService } from './admin-organizations.service';
import { AdminRulesetsService } from './admin-rulesets.service';
import { AdminUsersService } from './admin-users.service';
import { AuditLogAdminController } from './audit-log.controller';
import { CustomRulesetsAdminController } from './custom-rulesets/custom-rulesets.controller';
import { CustomRulesetsService } from './custom-rulesets/custom-rulesets.service';
import { OrgCustomRulesetsController } from './custom-rulesets/org-custom-rulesets.controller';
import { AdminDashboardStatsController } from './dashboard-stats.controller';
import { ExchangeEditRequestsAdminController } from './exchange-edit-requests.controller';
import { ExchangeEditRequestsAdminService } from './exchange-edit-requests.service';
import { FeatureFlagsAdminController } from './feature-flags.controller';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { LeagueScoringSystemsController } from './league-scoring-systems/league-scoring-systems.controller';
import { LeagueScoringSystemsService } from './league-scoring-systems/league-scoring-systems.service';
import { OrganizationsAdminController } from './organizations.controller';
import { PlatformAISettingsController } from './platform-ai-settings.controller';
import { PlatformAISettingsService } from './platform-ai-settings.service';
import { PublicFeatureFlagsController } from './public-feature-flags.controller';
import { RulesetsAdminController } from './rulesets.controller';
import { AdminSystemActionsService } from './system-actions.service';
import { AdminSystemVersionsService } from './system-versions.service';
import { SystemVersionsAdminController } from './system-versions.controller';
import { UsersAdminController } from './users.controller';

@Module({
  imports: [HemaRatingsModule, MatchesModule, OrganizationsModule],
  controllers: [
    OrganizationsAdminController,
    UsersAdminController,
    RulesetsAdminController,
    CustomRulesetsAdminController,
    OrgCustomRulesetsController,
    FeatureFlagsAdminController,
    PublicFeatureFlagsController,
    AuditLogAdminController,
    ExchangeEditRequestsAdminController,
    SystemVersionsAdminController,
    BackupsAdminController,
    PlatformAISettingsController,
    AIDataQualityController,
    AdminDashboardStatsController,
    HemaRatingsAdminController,
    LeagueScoringSystemsController,
  ],
  providers: [
    AdminOrganizationsService,
    AdminUsersService,
    AdminRulesetsService,
    CustomRulesetsService,
    AdminDashboardStatsService,
    AdminFeatureFlagsService,
    AdminAuditLogService,
    ExchangeEditRequestsAdminService,
    { provide: AdminSystemVersionsService, useFactory: () => new AdminSystemVersionsService() },
    {
      provide: AdminSystemActionsService,
      // Use useFactory so Nest only injects SupabaseService; the second
      // constructor param (AdminSystemActionsServiceOptions) is an interface
      // — it has no runtime token, so leaving the service as a plain provider
      // crashes DI with "Cannot resolve parameter at index [1]".
      useFactory: (supabase: SupabaseService) => new AdminSystemActionsService(supabase),
      inject: [SupabaseService],
    },
    { provide: AdminBackupsService, useFactory: () => new AdminBackupsService() },
    PlatformAISettingsService,
    AIDataQualityService,
    LeagueScoringSystemsService,
    SuperAdminGuard,
  ],
  exports: [
    SuperAdminGuard,
    AdminFeatureFlagsService,
    AIDataQualityService,
    LeagueScoringSystemsService,
  ],
})
export class AdminModule {}
