import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { StaffController } from './staff.controller';
import { StaffJwtService } from './staff-jwt.service';
import { StaffService } from './staff.service';

@Module({
  imports: [SupabaseModule, OrganizationsModule],
  controllers: [StaffController],
  providers: [StaffService, StaffJwtService],
  exports: [StaffService, StaffJwtService],
})
export class StaffModule {}
