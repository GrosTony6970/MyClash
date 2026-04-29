import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { OnboardingService } from './onboarding.service';
import { OrganizationsService } from './organizations.service';

@Module({
  controllers: [OrganizationsController],
  providers: [OnboardingService, OrganizationsService],
  exports: [OnboardingService, OrganizationsService],
})
export class OrganizationsModule {}
