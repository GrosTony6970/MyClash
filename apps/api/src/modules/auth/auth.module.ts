import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PrivacyModule } from '../privacy/privacy.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GuestJwtGuard } from './guest-jwt.guard';
import { GuestJwtService } from './guest-jwt.service';
import { GuestSessionsController } from './guest-sessions.controller';
import { MeController } from './me.controller';
import { SignupController } from './signup.controller';

@Module({
  // PrivacyModule imports nothing, so this edge cannot form a cycle.
  imports: [OrganizationsModule, PrivacyModule],
  controllers: [AuthController, SignupController, GuestSessionsController, MeController],
  providers: [AuthService, GuestJwtService, GuestJwtGuard],
  exports: [AuthService, GuestJwtService, GuestJwtGuard],
})
export class AuthModule {}
