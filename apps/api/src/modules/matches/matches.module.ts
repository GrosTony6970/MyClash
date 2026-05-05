import { Module } from '@nestjs/common';
import { WorkersModule } from '../../workers/workers.module';
import { StaffModule } from '../staff/staff.module';
import { ClockService } from './clock.service';
import { FrozenResultsGuard } from './frozen-results.guard';
import { MatchAutoLockService } from './match-auto-lock.service';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { ScoringService } from './scoring.service';

@Module({
  imports: [WorkersModule, StaffModule],
  controllers: [MatchesController],
  providers: [
    MatchesService,
    ScoringService,
    ClockService,
    FrozenResultsGuard,
    MatchAutoLockService,
  ],
  exports: [MatchesService, ScoringService, ClockService, FrozenResultsGuard],
})
export class MatchesModule {}
