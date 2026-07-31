import { Module } from '@nestjs/common';
import { PhasesModule } from '../phases/phases.module';
import { PoolStandingsModule } from '../pool-standings/pool-standings.module';
import { SwissCoreModule } from '../swiss/swiss-core.module';
import { TournamentPlacementService } from './tournament-placement.service';

/**
 * Shared tournament-placement authority. Imports the bracket + pool-standings
 * services and exports a single `TournamentPlacementService` that both
 * FightersModule (career placements) and LeaguesModule (league scoring) consume,
 * so every surface derives a fighter's finish from the same `computeFinalRanking`.
 */
@Module({
  // SwissCoreModule (the LEAF), never SwissModule: this module is reachable
  // from PhasesModule, so the full Swiss module would close a cycle.
  imports: [PhasesModule, PoolStandingsModule, SwissCoreModule],
  providers: [TournamentPlacementService],
  exports: [TournamentPlacementService],
})
export class TournamentPlacementModule {}
