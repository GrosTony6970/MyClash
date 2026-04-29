import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GuestJwtGuard } from './guest-jwt.guard';
import { GuestJwtService } from './guest-jwt.service';
import { GuestSessionsController } from './guest-sessions.controller';
import { MeController } from './me.controller';
import { SignupController } from './signup.controller';

@Module({
  imports: [OrganizationsModule],
  controllers: [AuthController, SignupController, GuestSessionsController, MeController],
  providers: [AuthService, GuestJwtService, GuestJwtGuard],
  exports: [AuthService, GuestJwtService, GuestJwtGuard],
})
export class AuthModule {}
