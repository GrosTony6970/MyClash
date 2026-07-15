import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { OnboardingService } from './onboarding.service';
import { OrganizationsService } from './organizations.service';
import { UserDirectoryModule } from '../user-directory/user-directory.module';

@Module({
  imports: [UserDirectoryModule],
  controllers: [OrganizationsController],
  providers: [OnboardingService, OrganizationsService],
  exports: [OnboardingService, OrganizationsService],
})
export class OrganizationsModule {}
