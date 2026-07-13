import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { PoolStandingsModule } from '../pool-standings/pool-standings.module';
import { PhasesModule } from '../phases/phases.module';
import { FollowsModule } from '../follows/follows.module';
import { MePeopleController } from './me-people.controller';
import { PeopleContextService } from './people-context.service';

/**
 * People-hub enrichment: live tournament context for a set of global persons,
 * and the caller's persistent "Following" list. Composes FollowsService
 * (follow state) with PoolStandingsService (rank) and PhasesService (final rank
 * via the shared bracket ranking) over shared Supabase reads.
 */
@Module({
  imports: [SupabaseModule, PoolStandingsModule, PhasesModule, FollowsModule],
  controllers: [MePeopleController],
  providers: [PeopleContextService],
  exports: [PeopleContextService],
})
export class PeopleContextModule {}
