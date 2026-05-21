import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  registry,
  TF_v1,
  Generic_PointsCap,
  type RankingRule,
  type StandingsColumn,
  type RulesetMetadata,
} from '@myclash/rulesets';

interface RulesetSummary {
  code: string;
  version: string;
  label: string;
  /** Tie-breaker chain applied to pool standings (in order, primary first). */
  rankingChain: RankingRule[];
  /** Columns the ruleset declares for the standings table. */
  standingsColumns: StandingsColumn[];
  /** Audit-friendly defaults (afterblow window, double-penalty formula, etc.). */
  metadata: RulesetMetadata;
}

// Ensure all built-in rulesets are registered (idempotent — guarded with has()).
// This mirrors the same guard in scoring.service.ts so either module can load first.
for (const ruleset of [TF_v1, Generic_PointsCap]) {
  if (!registry.has(ruleset.code, ruleset.version)) {
    registry.register(ruleset);
  }
}

@ApiTags('rulesets')
@Controller('rulesets')
export class RulesetsController {
  /** GET /api/v1/rulesets — public catalog of available rulesets. */
  @Get()
  @ApiOperation({ summary: 'List available rulesets for the tournament config wizard' })
  list(): RulesetSummary[] {
    return registry.list().map((ruleset) => ({
      code: ruleset.code,
      version: ruleset.version,
      label: ruleset.displayName ?? `${ruleset.code} v${ruleset.version}`,
      rankingChain: ruleset.rankingChain ?? [],
      standingsColumns: ruleset.standingsColumns ?? [],
      metadata: ruleset.metadata ?? {},
    }));
  }
}
