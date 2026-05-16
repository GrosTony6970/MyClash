import { Module } from '@nestjs/common';
import { MatchesModule } from '../matches/matches.module';
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
import { AdminDashboardStatsController } from './dashboard-stats.controller';
import { ExchangeEditRequestsAdminController } from './exchange-edit-requests.controller';
import { ExchangeEditRequestsAdminService } from './exchange-edit-requests.service';
import { FeatureFlagsAdminController } from './feature-flags.controller';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { OrganizationsAdminController } from './organizations.controller';
import { PlatformAISettingsController } from './platform-ai-settings.controller';
import { PlatformAISettingsService } from './platform-ai-settings.service';
import { RulesetsAdminController } from './rulesets.controller';
import { AdminSystemVersionsService } from './system-versions.service';
import { SystemVersionsAdminController } from './system-versions.controller';
import { UsersAdminController } from './users.controller';

@Module({
  imports: [MatchesModule],
  controllers: [
    OrganizationsAdminController,
    UsersAdminController,
    RulesetsAdminController,
    FeatureFlagsAdminController,
    AuditLogAdminController,
    ExchangeEditRequestsAdminController,
    SystemVersionsAdminController,
    BackupsAdminController,
    PlatformAISettingsController,
    AIDataQualityController,
    AdminDashboardStatsController,
  ],
  providers: [
    AdminOrganizationsService,
    AdminUsersService,
    AdminRulesetsService,
    AdminDashboardStatsService,
    AdminFeatureFlagsService,
    AdminAuditLogService,
    ExchangeEditRequestsAdminService,
    { provide: AdminSystemVersionsService, useFactory: () => new AdminSystemVersionsService() },
    { provide: AdminBackupsService, useFactory: () => new AdminBackupsService() },
    PlatformAISettingsService,
    AIDataQualityService,
    SuperAdminGuard,
  ],
  exports: [SuperAdminGuard],
})
export class AdminModule {}
