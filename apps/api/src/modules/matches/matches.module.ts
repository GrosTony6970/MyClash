import { Module } from '@nestjs/common';
import { WorkersModule } from '../../workers/workers.module';
import { ClockService } from './clock.service';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { ScoringService } from './scoring.service';

@Module({
  imports: [WorkersModule],
  controllers: [MatchesController],
  providers: [MatchesService, ScoringService, ClockService],
  exports: [MatchesService, ScoringService, ClockService],
})
export class MatchesModule {}
