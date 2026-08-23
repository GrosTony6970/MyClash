/**
 * packages/rulesets/src/registry.ts
 *
 * Ruleset registry — maps (code, version) → Ruleset implementation.
 *
 * Usage:
 *   const registry = new RulesetRegistry();
 *   registry.register(TF_v1);
 *   const ruleset = registry.get('TF_v1', '1.0.0');
 *
 * ── Why this is a class and not a singleton ─────────────────────────────────
 * It used to export `const registry = new RulesetRegistry()`, and the API
 * populated that shared object from module scope. Two things followed from it.
 *
 * `register` throws on a duplicate, and module scope runs once per module but
 * more than once across a test file, so both writers grew the same workaround:
 * `if (!registry.has(code, version)) registry.register(ruleset)`. The comment
 * above one of them called it "idempotent"; it was a guard against a global
 * that outlived the thing writing to it.
 *
 * And `clear()` existed for tests alone — five files called it — because a
 * shared mutable map leaks between them. A registry the owner constructs needs
 * neither: the API builds exactly one through Nest DI, and a test builds its
 * own.
 */
import type { Ruleset } from './types';

export class RulesetRegistry {
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
      a.code !== b.code ? a.code.localeCompare(b.code) : a.version.localeCompare(b.version),
    );
  }

  /**
   * Check if a ruleset is registered.
   */
  has(code: string, version: string): boolean {
    return this.store.has(this.key(code, version));
  }
}
