import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { registry, TF_v1, TF_v1_no_afterblow, Generic_PointsCap } from '@myclash/rulesets';

interface RulesetSummary {
  code: string;
  version: string;
  label: string;
}

// Ensure all built-in rulesets are registered (idempotent — guarded with has()).
// This mirrors the same guard in scoring.service.ts so either module can load first.
for (const ruleset of [TF_v1, TF_v1_no_afterblow, Generic_PointsCap]) {
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
      label:
        (ruleset as { label?: string }).label ??
        ruleset.displayName ??
        `${ruleset.code} v${ruleset.version}`,
    }));
  }
}
