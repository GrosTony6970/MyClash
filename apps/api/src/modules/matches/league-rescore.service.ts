import { Injectable, Logger } from '@nestjs/common';
// Value imports, not `import type`: Nest needs the runtime classes for DI metadata.
import { LeaguesService } from '../leagues/leagues.service';
import { FrozenResultsGuard } from './frozen-results.guard';

/**
 * League results follow a hit or a card that lands on an Event that is over
 * (ruling 248).
 *
 * League points are scored when an Event completes, and by a League admin's
 * Recompute. A final corrected after that left the League table on the old
 * points, and nobody told the League admin. A Pool ranks on points too, so a
 * correction that keeps the winner counts as well.
 *
 * The whole Event is scored again: its Tournaments share a League's ranking. A
 * finalised season is skipped by `recomputeForEvent` itself.
 *
 * Its own provider, in `MatchesModule`: `LeaguesModule` reaches `PhasesModule`
 * through the placement module, so `MatchCompletionService` cannot hold it.
 */
@Injectable()
export class LeagueRescoreService {
  private readonly logger = new Logger(LeagueRescoreService.name);

  constructor(
    private readonly frozenResults: FrozenResultsGuard,
    private readonly leagues: LeaguesService,
  ) {}

  /**
   * Asked AFTER the row and the bracket are written: a placement reads both.
   *
   * Never throws: the hit or the card is already saved, and a retry of it would
   * not come back here. A failure is logged, and the League admin's Recompute
   * still repairs the table.
   *
   * The race: two corrections close together run two re-scores, and the older
   * one may write last. Each replaces a Tournament's rows whole from what the
   * database holds when it reads, so the table is whole either way; it can miss
   * the newer correction until the next one, or the Recompute.
   */
  async afterResultWrite(matchId: string): Promise<void> {
    try {
      const eventId = await this.frozenResults.overEventId(matchId);
      if (eventId) await this.leagues.recomputeForEvent(eventId);
    } catch (err) {
      this.logger.warn(
        `League results were not scored again after match ${matchId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
