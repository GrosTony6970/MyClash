import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PersonsModule } from '../persons/persons.module';
import { MeController } from './me.controller';
import { MeEventsService } from './me-events.service';

@Module({
  // No cycle: only AppModule imports MeModule.
  imports: [SupabaseModule, OrganizationsModule, PersonsModule],
  controllers: [MeController],
  providers: [MeEventsService],
})
export class MeModule {}
