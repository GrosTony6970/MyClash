import { Module } from '@nestjs/common';
import { AdminFeatureFlagsService } from './admin-feature-flags.service';
import { AdminOrganizationsService } from './admin-organizations.service';
import { AdminRulesetsService } from './admin-rulesets.service';
import { AdminUsersService } from './admin-users.service';
import { FeatureFlagsAdminController } from './feature-flags.controller';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { OrganizationsAdminController } from './organizations.controller';
import { RulesetsAdminController } from './rulesets.controller';
import { UsersAdminController } from './users.controller';

@Module({
  controllers: [
    OrganizationsAdminController,
    UsersAdminController,
    RulesetsAdminController,
    FeatureFlagsAdminController,
  ],
  providers: [
    AdminOrganizationsService,
    AdminUsersService,
    AdminRulesetsService,
    AdminFeatureFlagsService,
    SuperAdminGuard,
  ],
  exports: [SuperAdminGuard],
})
export class AdminModule {}
