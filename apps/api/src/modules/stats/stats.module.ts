import { Module } from '@nestjs/common';
import { RulesetResolverModule } from '../matches/ruleset-resolver.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  // RulesetResolver labels the afterblow columns from the tournament ruleset.
  // Its own module, so importing it closes no cycle -- see its header.
  // OrganizationsModule: the controller shows a hidden Tournament to its club's
  // members (competition-visibility.ts).
  imports: [RulesetResolverModule, OrganizationsModule],
  controllers: [StatsController],
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}
