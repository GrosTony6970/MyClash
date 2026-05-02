import { Module } from '@nestjs/common';
import { WorkersModule } from '../../workers/workers.module';
import { AuthModule } from '../auth/auth.module';
import { PersonsModule } from '../persons/persons.module';
import { FollowsController } from './follows.controller';
import { FollowsService } from './follows.service';

@Module({
  imports: [AuthModule, PersonsModule, WorkersModule],
  controllers: [FollowsController],
  providers: [FollowsService],
  exports: [FollowsService],
})
export class FollowsModule {}
