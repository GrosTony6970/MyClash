import { describe, expect, it } from 'vitest';
import { GenericPointsCapDefaultConfig } from '@myclash/rulesets';
import { resolveRulesetConfigDefaults } from './ruleset-defaults';
import { validateTournamentRulesetConfig } from './tournament-config';
import { mockSupabase } from '../../common/testing/supabase-chain';

/**
 * A Points-cap Tournament starts from the engine's defaults with Points cap's row laid over them,
 * so the match format a platform admin stores there is where new Tournaments start (operator ruling
 * 139). A guard: the seed already read the row; the editor did not write it.
 */
const pointsCapRow = (tfConfig: Record<string, unknown> | null) =>
  mockSupabase({
    custom_rulesets: {
      rows: [{ code: 'Generic_PointsCap', is_system: true, tf_config: tfConfig }],
    },
  });

async function startOf(tfConfig: Record<string, unknown> | null) {
  const defaults = await resolveRulesetConfigDefaults(
    pointsCapRow(tfConfig) as never,
    'Generic_PointsCap',
    '1.0.0',
  );
  return validateTournamentRulesetConfig('Generic_PointsCap', defaults);
}

describe("Points cap's row as a Tournament's start", () => {
  it('seeds the engine’s defaults when the row holds nothing', async () => {
    expect(await startOf(null)).toEqual(GenericPointsCapDefaultConfig);
  });

  it('starts at the pool time a platform admin stored', async () => {
    const start = await startOf({ matchFormat: { timeLimitsSeconds: { pool: 120 } } });

    expect(start.matchFormat.timeLimitsSeconds.pool).toBe(120);
    expect(start.matchFormat.pointCap).toBe(GenericPointsCapDefaultConfig.matchFormat.pointCap);
  });
});
