import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SignupController } from './signup.controller';

@Module({
  imports: [OrganizationsModule],
  controllers: [AuthController, SignupController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
