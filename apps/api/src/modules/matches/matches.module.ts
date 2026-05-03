import { Module } from '@nestjs/common';
import { WorkersModule } from '../../workers/workers.module';
import { ClockService } from './clock.service';
import { FrozenResultsGuard } from './frozen-results.guard';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { ScoringService } from './scoring.service';

@Module({
  imports: [WorkersModule],
  controllers: [MatchesController],
  providers: [MatchesService, ScoringService, ClockService, FrozenResultsGuard],
  exports: [MatchesService, ScoringService, ClockService, FrozenResultsGuard],
})
export class MatchesModule {}
