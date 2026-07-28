import { Module } from '@nestjs/common';
import { WorkersModule } from '../../workers/workers.module';
import { StaffModule } from '../staff/staff.module';
import { PhasesModule } from '../phases/phases.module';
import { ClockService } from './clock.service';
import { FrozenResultsGuard } from './frozen-results.guard';
import { MatchAuditService } from './match-audit.service';
import { MatchAutoLockService } from './match-auto-lock.service';
import { MatchForfeitsService } from './match-forfeits.service';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { RulesetResolverModule } from './ruleset-resolver.module';
import { ScoringService } from './scoring.service';

@Module({
  // RulesetResolver now arrives via RulesetResolverModule rather than being a
  // private provider here, so PoolStandingsModule can inject it without
  // importing MatchesModule (which would close a cycle through PhasesModule).
  imports: [WorkersModule, StaffModule, PhasesModule, RulesetResolverModule],
  controllers: [MatchesController],
  providers: [
    MatchesService,
    MatchAuditService,
    ScoringService,
    ClockService,
    FrozenResultsGuard,
    MatchAutoLockService,
    MatchForfeitsService,
  ],
  exports: [MatchesService, ScoringService, ClockService, FrozenResultsGuard, MatchForfeitsService],
})
export class MatchesModule {}
