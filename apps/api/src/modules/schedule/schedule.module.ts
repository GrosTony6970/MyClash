import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PersonsModule } from '../persons/persons.module';
import { MyScheduleController } from './my-schedule.controller';

@Module({
  imports: [AuthModule, PersonsModule],
  controllers: [MyScheduleController],
})
export class ScheduleModule {}
