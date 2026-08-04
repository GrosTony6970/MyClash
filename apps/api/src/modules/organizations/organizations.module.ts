import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { OnboardingService } from './onboarding.service';
import { OrganizationsService } from './organizations.service';
import { PrivacyModule } from '../privacy/privacy.module';
import { UserDirectoryModule } from '../user-directory/user-directory.module';

@Module({
  // PrivacyModule imports nothing, so this edge cannot form a cycle — the same
  // reason AuthModule can depend on it. Onboarding needs LegalAcceptanceService
  // because the password signup path is where an organiser account is created.
  imports: [UserDirectoryModule, PrivacyModule],
  controllers: [OrganizationsController],
  providers: [OnboardingService, OrganizationsService],
  exports: [OnboardingService, OrganizationsService],
})
export class OrganizationsModule {}
