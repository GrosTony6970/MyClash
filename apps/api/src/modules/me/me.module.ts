import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PersonsModule } from '../persons/persons.module';
import { MeController } from './me.controller';
import { MeEventsService } from './me-events.service';

@Module({
  // No cycle: AppModule and PhotosModule import MeModule, and it imports nothing of either.
  imports: [SupabaseModule, OrganizationsModule, PersonsModule],
  controllers: [MeController],
  providers: [MeEventsService],
  // The signed-in photo upload asks "one of her Events" of the same list (design Goal 11).
  exports: [MeEventsService],
})
export class MeModule {}
