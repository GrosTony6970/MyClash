import { describe, it, expect, beforeEach } from 'vitest';
import { RulesetRegistry } from './registry';
import { TF_v1 } from './tf_v1';

describe('RulesetRegistry', () => {
  // A fresh registry per case — the isolation `clear()` used to fake on a
  // shared singleton.
  let registry: RulesetRegistry;
  beforeEach(() => {
    registry = new RulesetRegistry();
  });

  it('register() adds a ruleset', () => {
    registry.register(TF_v1);
    expect(registry.has('TF_v1', '1.0.0')).toBe(true);
  });

  it('get() returns the registered ruleset', () => {
    registry.register(TF_v1);
    const r = registry.get('TF_v1', '1.0.0');
    expect(r.code).toBe('TF_v1');
    expect(r.version).toBe('1.0.0');
  });

  it('get() throws for unknown ruleset', () => {
    expect(() => registry.get('Unknown', '1.0.0')).toThrow('not found');
  });

  it('register() throws on duplicate', () => {
    registry.register(TF_v1);
    expect(() => registry.register(TF_v1)).toThrow('already registered');
  });

  it('list() returns all registered rulesets sorted', () => {
    registry.register(TF_v1);
    const list = registry.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.code).toBe('TF_v1');
  });

  it('list() returns empty array when nothing registered', () => {
    expect(registry.list()).toHaveLength(0);
  });

  it('TF_v1 has a valid configSchema (Zod)', () => {
    registry.register(TF_v1);
    const r = registry.get('TF_v1', '1.0.0');
    // configSchema.parse should not throw for empty object (uses defaults)
    expect(() => r.configSchema.parse({})).not.toThrow();
  });
});
