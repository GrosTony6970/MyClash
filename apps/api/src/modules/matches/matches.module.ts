import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { WorkersModule } from '../../workers/workers.module';
import { StaffModule } from '../staff/staff.module';
import { PhasesModule } from '../phases/phases.module';
import { RefereesModule } from '../referees/referees.module';
import { ClockService } from './clock.service';
import { FrozenResultsModule } from './frozen-results.module';
import { MatchAuditService } from './match-audit.service';
import { MatchAutoLockService } from './match-auto-lock.service';
import { MatchForfeitsService } from './match-forfeits.service';
import { MatchPlacementModule } from './match-placement.module';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { RulesetResolverModule } from './ruleset-resolver.module';
import { ScoringService } from './scoring.service';

@Module({
  // RulesetResolver now arrives via RulesetResolverModule rather than being a
  // private provider here, so PoolStandingsModule can inject it without
  // importing MatchesModule (which would close a cycle through PhasesModule).
  // FrozenResultsModule is the same move for the same reason — see its header.
  imports: [
    WorkersModule,
    StaffModule,
    PhasesModule,
    RulesetResolverModule,
    FrozenResultsModule,
    OrganizationsModule,
    MatchPlacementModule,
    // The per-bout crew door asks the referee checker (ADR-016). Exports are not
    // transitive: PhasesModule imports RefereesModule but does not re-export it.
    RefereesModule,
  ],
  controllers: [MatchesController],
  providers: [
    MatchesService,
    MatchAuditService,
    ScoringService,
    ClockService,
    MatchAutoLockService,
    MatchForfeitsService,
  ],
  exports: [MatchesService, ScoringService, ClockService, MatchForfeitsService],
})
export class MatchesModule {}
