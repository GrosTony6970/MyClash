import { Module } from '@nestjs/common';
import { PhasesModule } from '../phases/phases.module';
import { PoolStandingsModule } from '../pool-standings/pool-standings.module';
import { TournamentPlacementService } from './tournament-placement.service';

/**
 * Shared tournament-placement authority. Imports the bracket + pool-standings
 * services and exports a single `TournamentPlacementService` that both
 * FightersModule (career placements) and LeaguesModule (league scoring) consume,
 * so every surface derives a fighter's finish from the same `computeFinalRanking`.
 */
@Module({
  imports: [PhasesModule, PoolStandingsModule],
  providers: [TournamentPlacementService],
  exports: [TournamentPlacementService],
})
export class TournamentPlacementModule {}
