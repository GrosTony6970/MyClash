import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { PersonsModule } from '../persons/persons.module';
import { MeController } from './me.controller';
import { MeEventsService } from './me-events.service';

@Module({
  imports: [SupabaseModule, PersonsModule],
  controllers: [MeController],
  providers: [MeEventsService],
})
export class MeModule {}
