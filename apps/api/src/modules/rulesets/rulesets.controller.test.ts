import { describe, expect, it } from 'vitest';
import { RulesetsController } from './rulesets.controller';

describe('RulesetsController', () => {
  it('returns the registry list mapped to { code, version, label }', () => {
    const controller = new RulesetsController();
    const result = controller.list();

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
    for (const entry of result) {
      expect(entry).toMatchObject({
        code: expect.any(String),
        version: expect.any(String),
        label: expect.any(String),
      });
    }
    // The well-known TF_v1 ruleset must be present.
    expect(result.find((r) => r.code === 'TF_v1')).toBeDefined();
  });
});
