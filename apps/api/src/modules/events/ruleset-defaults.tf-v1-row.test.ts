import { describe, expect, it } from 'vitest';
import { TFv1DefaultConfig } from '@myclash/rulesets';
import { resolveRulesetConfigDefaults } from './ruleset-defaults';
import { mockSupabase } from '../../common/testing/supabase-chain';

/**
 * A TF_v1 Tournament starts from the engine's defaults with TF_v1's row laid over them. Migration
 * 0245 empties that row of the engine's own values (operator rulings 61 and 135): an empty row
 * must seed exactly the engine, and a value a platform admin set must still win.
 */
const tfV1Row = (tfConfig: Record<string, unknown>) =>
  mockSupabase({
    custom_rulesets: { rows: [{ code: 'TF_v1', is_system: true, tf_config: tfConfig }] },
  });

describe("TF_v1's row as a Tournament's start", () => {
  it('seeds the engine’s defaults when the row holds nothing of its own', async () => {
    expect(await resolveRulesetConfigDefaults(tfV1Row({}) as never, 'TF_v1', '1.0.0')).toEqual(
      TFv1DefaultConfig,
    );
  });

  it('lays a platform admin’s value over them', async () => {
    const start = await resolveRulesetConfigDefaults(
      tfV1Row({ winBonus: 4, matchFormat: { timeLimitsSeconds: { pool: 120 } } }) as never,
      'TF_v1',
      '1.0.0',
    );

    expect(start).toEqual({
      ...TFv1DefaultConfig,
      winBonus: 4,
      matchFormat: {
        ...TFv1DefaultConfig.matchFormat,
        timeLimitsSeconds: { ...TFv1DefaultConfig.matchFormat.timeLimitsSeconds, pool: 120 },
      },
    });
  });
});
