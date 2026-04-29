import { Module } from '@nestjs/common';
import { AdminOrganizationsService } from './admin-organizations.service';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { OrganizationsAdminController } from './organizations.controller';

@Module({
  controllers: [OrganizationsAdminController],
  providers: [AdminOrganizationsService, SuperAdminGuard],
  exports: [SuperAdminGuard],
})
export class AdminModule {}
