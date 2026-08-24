import { Module } from '@nestjs/common';
import { RulesetResolverModule } from '../matches/ruleset-resolver.module';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  // RulesetResolver labels the afterblow columns from the tournament ruleset.
  // Its own module, so importing it closes no cycle -- see its header.
  imports: [RulesetResolverModule],
  controllers: [StatsController],
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}
