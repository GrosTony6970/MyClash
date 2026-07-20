import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { RulesetResolverModule } from '../matches/ruleset-resolver.module';
import { PoolStandingsController } from './pool-standings.controller';
import { PoolStandingsService } from './pool-standings.service';

@Module({
  // RulesetResolverModule is the DB-aware ruleset lookup (registry → version
  // snapshot → custom_rulesets). Standings currently resolve through the
  // in-memory registry only, which is why org-authored rulesets 400; wiring the
  // module here is the prerequisite for switching that over.
  imports: [SupabaseModule, RulesetResolverModule],
  controllers: [PoolStandingsController],
  providers: [PoolStandingsService],
  exports: [PoolStandingsService],
})
export class PoolStandingsModule {}
