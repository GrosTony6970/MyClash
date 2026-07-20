import { Module } from '@nestjs/common';
import { RulesetResolver } from './ruleset-resolver.service';

/**
 * RulesetResolver gets its own module so more than one feature module can
 * inject it.
 *
 * It used to be a bare provider inside MatchesModule and was never exported, so
 * the only way for PoolStandingsModule to reach it was to import MatchesModule
 * — which closes a module cycle:
 *
 *   PoolStandingsModule → MatchesModule → PhasesModule → PoolStandingsModule
 *
 * Extracting the provider breaks that cycle at the leaf instead of papering
 * over it with forwardRef(). RulesetResolver's only dependency is
 * SupabaseService, and SupabaseModule is @Global, so this module needs no
 * imports of its own.
 */
@Module({
  providers: [RulesetResolver],
  exports: [RulesetResolver],
})
export class RulesetResolverModule {}
