import { Global, Module } from '@nestjs/common';
import { RulesetRegistry } from '@myclash/rulesets';
import { createRulesetRegistry } from './ruleset-registry';

/**
 * The one ruleset registry, built once at boot with the built-ins already in it.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 * `@myclash/rulesets` used to export a module-scope `registry` singleton, and
 * two places in the API wrote to it from module scope — `scoring.service.ts`
 * and `rulesets.controller.ts`. Neither could know whether the other had run
 * first, and `register` throws on a duplicate, so both carried the same guard:
 *
 *     if (!registry.has(ruleset.code, ruleset.version)) registry.register(ruleset);
 *
 * A comment called that "idempotent". It was a workaround for a global written
 * from two places at import time. Registering in a factory that runs exactly
 * once removes the ambiguity rather than tolerating it.
 *
 * ── Why @Global ─────────────────────────────────────────────────────────────
 * The registry is a single process-wide catalogue with no dependencies of its
 * own, read by six feature modules that are otherwise unrelated. Threading an
 * import through all six would add edges to a graph `module-graph.test.ts`
 * exists to keep acyclic, and would buy nothing: there is no second registry a
 * module could legitimately want.
 *
 * Tests do not use this module. They call `createRulesetRegistry()` directly,
 * or build a bare `RulesetRegistry` and register only what the case needs.
 */
@Global()
@Module({
  providers: [{ provide: RulesetRegistry, useFactory: createRulesetRegistry }],
  exports: [RulesetRegistry],
})
export class RulesetRegistryModule {}
