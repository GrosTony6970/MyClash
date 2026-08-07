import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIUsageModule } from '../ai-usage/ai-usage.module';
import { HemaRatingsModule } from '../hema-ratings/hema-ratings.module';
import { MatchesModule } from '../matches/matches.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SupabaseService } from '../supabase/supabase.service';
import { HemaRatingsAdminController } from './hema-ratings-admin.controller';
import { AIDataQualityController } from './ai-data-quality.controller';
import { AIDataQualityService } from './ai-data-quality.service';
import { AdminAuditLogService } from './admin-audit-log.service';
import { AdminPlatformLogService } from './admin-platform-log.service';
import { BackupsAdminController } from './backups.controller';
import { AdminBackupsService } from './backups.service';
import { AdminDashboardStatsService } from './admin-dashboard-stats.service';
import { AdminFeatureFlagsService } from './admin-feature-flags.service';
import { AdminOrganizationsService } from './admin-organizations.service';
import { AdminUsersService } from './admin-users.service';
import { AuditLogAdminController } from './audit-log.controller';
import { ClaimRequestsAdminController } from './claim-requests.controller';
import { ClaimRequestsService } from './claim-requests.service';
import { CustomRulesetsAdminController } from './custom-rulesets/custom-rulesets.controller';
import { CustomRulesetsService } from './custom-rulesets/custom-rulesets.service';
import { OrgCustomRulesetsController } from './custom-rulesets/org-custom-rulesets.controller';
import { AdminDashboardStatsController } from './dashboard-stats.controller';
import { ExchangeEditRequestsAdminController } from './exchange-edit-requests.controller';
import { ExchangeEditRequestsAdminService } from './exchange-edit-requests.service';
import { FeatureFlagsAdminController } from './feature-flags.controller';
import { PlatformRoleGuard } from './guards/platform-role.guard';
import { LeagueScoringSystemsController } from './league-scoring-systems/league-scoring-systems.controller';
import { LeagueScoringSystemsService } from './league-scoring-systems/league-scoring-systems.service';
import { ModelSyncService } from './model-sync.service';
import { OrganizationsAdminController } from './organizations.controller';
import { PlatformLogAdminController } from './platform-log.controller';
import { PlatformAIKeysController } from './platform-ai-keys.controller';
import { PlatformAISettingsController } from './platform-ai-settings.controller';
import { PlatformAISettingsService } from './platform-ai-settings.service';
import { PlatformAIUsageController } from './platform-ai-usage.controller';
import { PublicFeatureFlagsController } from './public-feature-flags.controller';
import { RuntimeHealthAdminController } from './runtime-health.controller';
import { AdminRuntimeHealthService } from './runtime-health.service';
import { RuntimeHealthAlertSettingsService } from './runtime-health-alert-settings.service';
import { RuntimeHealthSamplesService } from './runtime-health-samples.service';
import { createRuntimeHealthRedis } from './runtime-health/redis-connection';
import { collectDb } from './runtime-health/db-collector';
import { collectRedis } from './runtime-health/redis-collector';
import { collectQueues } from './runtime-health/queue-collector';
import { collectDisk } from './runtime-health/disk-collector';
import { AdminSystemActionsService } from './system-actions.service';
import { AdminSystemVersionsService } from './system-versions.service';
import { SystemVersionsAdminController } from './system-versions.controller';
import { AdminTlsStatusService } from './tls-status.service';
import { TlsStatusAdminController } from './tls-status.controller';
import { UsersAdminController } from './users.controller';
import { WeaponsAdminController } from './weapons/weapons-admin.controller';
import { WeaponsAdminService } from './weapons/weapons-admin.service';

@Module({
  imports: [HemaRatingsModule, MatchesModule, OrganizationsModule, AIUsageModule],
  controllers: [
    OrganizationsAdminController,
    UsersAdminController,
    CustomRulesetsAdminController,
    OrgCustomRulesetsController,
    FeatureFlagsAdminController,
    PublicFeatureFlagsController,
    AuditLogAdminController,
    PlatformLogAdminController,
    ExchangeEditRequestsAdminController,
    SystemVersionsAdminController,
    TlsStatusAdminController,
    BackupsAdminController,
    PlatformAISettingsController,
    PlatformAIKeysController,
    PlatformAIUsageController,
    AIDataQualityController,
    AdminDashboardStatsController,
    HemaRatingsAdminController,
    LeagueScoringSystemsController,
    ClaimRequestsAdminController,
    WeaponsAdminController,
    RuntimeHealthAdminController,
  ],
  providers: [
    ClaimRequestsService,
    AdminOrganizationsService,
    AdminUsersService,
    CustomRulesetsService,
    AdminDashboardStatsService,
    AdminFeatureFlagsService,
    AdminAuditLogService,
    AdminPlatformLogService,
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
    AdminTlsStatusService,
    { provide: AdminBackupsService, useFactory: () => new AdminBackupsService() },
    PlatformAISettingsService,
    ModelSyncService,
    AIDataQualityService,
    LeagueScoringSystemsService,
    WeaponsAdminService,
    PlatformRoleGuard,
    RuntimeHealthAlertSettingsService,
    RuntimeHealthSamplesService,
    {
      provide: AdminRuntimeHealthService,
      useFactory: (
        settings: RuntimeHealthAlertSettingsService,
        supabase: SupabaseService,
        systemActions: AdminSystemActionsService,
        config: ConfigService,
      ) => {
        const redis = createRuntimeHealthRedis(config);
        return new AdminRuntimeHealthService(settings, {
          collectDb: () => collectDb(supabase),
          collectRedis: () => collectRedis(redis),
          collectQueues: () => collectQueues(redis),
          collectDisk: () => collectDisk(systemActions),
        });
      },
      inject: [
        RuntimeHealthAlertSettingsService,
        SupabaseService,
        AdminSystemActionsService,
        ConfigService,
      ],
    },
  ],
  exports: [
    PlatformRoleGuard,
    AdminFeatureFlagsService,
    AIDataQualityService,
    LeagueScoringSystemsService,
    AdminTlsStatusService,
    AdminRuntimeHealthService,
    RuntimeHealthAlertSettingsService,
    RuntimeHealthSamplesService,
  ],
})
export class AdminModule {}
