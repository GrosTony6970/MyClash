import { describe, expect, it, vi } from 'vitest';
import { resolveRulesetConfigDefaults } from './ruleset-defaults';

/**
 * A ruleset's default settings are read or refused: a failed read throws, never a `{}` or the
 * static defaults written as the ruleset's (the audited settings change, revision 5 correction 3).
 */
const failing = () => {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'connection reset' } }),
  });
  return { service: { from: vi.fn(() => chain) } };
};

describe("a ruleset's default settings fail closed", () => {
  it("throws when a club ruleset's settings cannot be read", async () => {
    await expect(
      resolveRulesetConfigDefaults(failing() as never, 'club_x', '1.0.0'),
    ).rejects.toThrow('The settings of ruleset club_x@1.0.0 were not read: connection reset');
  });

  it("throws when a built-in's platform overrides cannot be read", async () => {
    await expect(
      resolveRulesetConfigDefaults(failing() as never, 'TF_v1', '1.0.0'),
    ).rejects.toThrow('The overrides of ruleset TF_v1 were not read: connection reset');
  });
});
