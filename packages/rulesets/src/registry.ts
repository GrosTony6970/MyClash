/**
 * packages/rulesets/src/registry.ts
 *
 * Ruleset registry — maps (code, version) → Ruleset implementation.
 *
 * Usage:
 *   import { registry } from '@myclash/rulesets';
 *   registry.register(TF_v1);
 *   const ruleset = registry.get('TF_v1', '1.0.0');
 */
import type { Ruleset } from './types';

class RulesetRegistry {
  private readonly store = new Map<string, Ruleset>();

  private key(code: string, version: string): string {
    return `${code}@${version}`;
  }

  /**
   * Register a ruleset implementation.
   * Throws if a ruleset with the same code+version is already registered.
   */
  register(ruleset: Ruleset): void {
    const k = this.key(ruleset.code, ruleset.version);
    if (this.store.has(k)) {
      throw new Error(`Ruleset ${k} is already registered`);
    }
    this.store.set(k, ruleset);
  }

  /**
   * Get a ruleset by code and version.
   * Throws if not found.
   */
  get(code: string, version: string): Ruleset {
    const k = this.key(code, version);
    const ruleset = this.store.get(k);
    if (!ruleset) {
      throw new Error(`Ruleset ${k} not found. Did you forget to register it?`);
    }
    return ruleset;
  }

  /**
   * List all registered rulesets (sorted by code then version).
   */
  list(): Ruleset[] {
    return [...this.store.values()].sort((a, b) =>
      a.code !== b.code
        ? a.code.localeCompare(b.code)
        : a.version.localeCompare(b.version),
    );
  }

  /**
   * Check if a ruleset is registered.
   */
  has(code: string, version: string): boolean {
    return this.store.has(this.key(code, version));
  }

  /**
   * Clear all registrations (for testing only).
   */
  clear(): void {
    this.store.clear();
  }
}

/** Singleton registry — import and use directly. */
export const registry = new RulesetRegistry();
