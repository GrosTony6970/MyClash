import { Module } from '@nestjs/common';
import { ProgrammeModule } from '../programme/programme.module';
import { RulesetResolverModule } from '../matches/ruleset-resolver.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { SwissAdvanceService } from './swiss-advance.service';
import { SwissPairingService } from './swiss-pairing.service';
import { SwissPublicRoundsService } from './swiss-public-rounds.service';
import { SwissRoundStateService } from './swiss-round-state.service';
import { SwissStandingsService } from './swiss-standings.service';

/**
 * LEAF module for Swiss. Nothing it imports may reach PhasesModule.
 *
 * Automatic advancement (decision 3) forces an edge FROM PhasesModule — its
 * MatchCompletionService has to invoke Swiss pairing when a round's last bout
 * finishes. Pointing that edge at the full SwissModule would close a cycle, and
 * a NestJS module cycle is invisible to `tsc` and to vitest (which runs through
 * esbuild and emits no decorator metadata): it surfaces only when the API
 * boots. This module exists so the edge has somewhere safe to land.
 *
 * The forbidden imports, each of which reaches PhasesModule:
 *   PhasesModule, MatchesModule, TournamentPlacementModule, LeaguesModule,
 *   WorkersModule, NotificationsModule, EventsModule, FollowsModule.
 *
 * NotificationsModule is the trap worth naming, because the notification this
 * module will eventually fire lives behind it:
 *   NotificationsModule → WorkersModule → LeaguesModule →
 *   TournamentPlacementModule → PhasesModule
 * The leaf NotificationSchedulingModule exports the same
 * NotificationEventsService without the back-edge — the fix RefereesModule
 * already uses. module-graph.test.ts pins all of this.
 */
@Module({
  imports: [SupabaseModule, ProgrammeModule, RulesetResolverModule],
  providers: [
    SwissPairingService,
    SwissRoundStateService,
    SwissAdvanceService,
    SwissStandingsService,
    SwissPublicRoundsService,
  ],
  exports: [
    SwissPairingService,
    SwissRoundStateService,
    SwissAdvanceService,
    SwissStandingsService,
    SwissPublicRoundsService,
  ],
})
export class SwissCoreModule {}
