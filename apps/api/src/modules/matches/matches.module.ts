import { Module } from '@nestjs/common';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { ScoringService } from './scoring.service';

@Module({
  controllers: [MatchesController],
  providers: [MatchesService, ScoringService],
  exports: [MatchesService, ScoringService],
})
export class MatchesModule {}
