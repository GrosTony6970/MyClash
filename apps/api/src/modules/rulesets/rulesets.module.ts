import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RulesetResolverModule } from '../matches/ruleset-resolver.module';
import { RulesetsController } from './rulesets.controller';
import { SelectableRulesetsService } from './selectable-rulesets.service';

/**
 * `RulesetResolverModule` (not `MatchesModule`) is imported deliberately: the
 * resolver was extracted into its own leaf module in 59bfb4bd precisely so
 * feature modules can reach it without dragging in Matches -> Phases and
 * closing a cycle. `module-graph.test.ts` guards that.
 */
@Module({
  imports: [OrganizationsModule, RulesetResolverModule],
  controllers: [RulesetsController],
  providers: [SelectableRulesetsService],
})
export class RulesetsModule {}
