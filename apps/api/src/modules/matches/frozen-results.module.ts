import { Module } from '@nestjs/common';
import { NotificationSchedulingModule } from '../notifications/notification-scheduling.module';
import { FrozenResultsGuard } from './frozen-results.guard';

/**
 * Leaf module owning the frozen-results interlock, so any feature module can
 * ask "may this actor still change what happened?".
 *
 * It was a bare provider inside MatchesModule, reachable only by importing
 * MatchesModule whole — which is fine for PenaltiesModule and AdminModule, and
 * impossible for anything MatchesModule itself depends on. MatchesModule imports
 * PhasesModule, so a phase-side owner of result mutation would close
 *
 *   PhasesModule → MatchesModule → PhasesModule
 *
 * and `module-graph.test.ts` fails the build on that edge rather than letting it
 * surface at boot. Extracting the provider breaks it at the leaf, the same way
 * RulesetResolverModule and NotificationSchedulingModule already do — no
 * forwardRef, no back-edge.
 *
 * The distinction matters more than the wiring: every existing consumer injects
 * this guard `@Optional()`, so an unresolvable provider does not fail, it
 * becomes `undefined` and `this.frozenResults?.assert…()` quietly stops
 * checking. A freeze that silently ceases to exist is the worst shape this
 * particular guard can take, which is why it gets a module rather than a
 * forwardRef.
 *
 * Only two dependencies, and neither re-enters the graph: SupabaseModule is
 * @Global, and NotificationSchedulerService comes from the notification leaf.
 */
@Module({
  imports: [NotificationSchedulingModule],
  providers: [FrozenResultsGuard],
  exports: [FrozenResultsGuard],
})
export class FrozenResultsModule {}
