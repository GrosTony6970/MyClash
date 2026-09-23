import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ModuleRef, ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';

/**
 * The API's whole module graph builds: every provider and controller resolves.
 *
 * Nothing else here would notice a broken wiring. Unit tests construct their
 * classes by hand, so a module that stops importing the module a provider comes
 * from — `OrganizationsModule` dropped from `hema-ratings.module.ts` — or an
 * injected class brought in with `import type`, which turns its entry in the
 * constructor's metadata into `Object`, keeps every test green while
 * `nest start` fails with "Nest can't resolve dependencies of …".
 * `module-graph.test.ts` reads the source for cycles; this builds the container.
 *
 * It can, because vitest's transform (Vite 8's oxc) emits decorator metadata
 * from this app's tsconfig (`emitDecoratorMetadata`), as `nest build` does. Both
 * breaks above turn this test red with Nest's own message. Without metadata it
 * would not: Nest reads a class with none as taking no arguments and calls
 * `new X()` in silence, so the build alone would pass whatever the wiring. The
 * second assertion is what keeps that from happening unseen — every class that
 * takes constructor arguments must carry its metadata. It also catches a
 * provider that lost its `@Injectable()`, which Nest builds the same silent way.
 *
 * `compile()` only: it builds every instance without the lifecycle hooks, so no
 * queue worker starts and nothing listens. The URLs point at a closed port so a
 * constructor that connects (BullMQ's queues do) reaches no developer's local
 * Redis or database. The keys are the five a constructor refuses to start
 * without.
 *
 * Not seen here: an `@Optional()` dependency brought in with `import type` —
 * Nest injects `undefined` and moves on (`di-wiring.regression.test.ts` guards
 * those by source); a feature module that only AppModule imports, dropped from
 * it — the graph still builds and its routes are simply gone; `main.ts`
 * (the Fastify adapter, global pipes); anything that runs at `init()` or on the
 * first request.
 */
describe('AppModule', () => {
  beforeAll(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:9');
    vi.stubEnv('SUPABASE_ANON_KEY', 'boot-test-anon-key');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'boot-test-service-role-key');
    vi.stubEnv('RESEND_API_KEY', 'boot-test-resend-key');
    vi.stubEnv('MYCLASH_GUEST_JWT_SECRET', 'boot-test-guest-secret-at-least-32-characters');
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:9');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('resolves every provider and controller, each from its own metadata', async () => {
    // Imported after the env is set: ConfigModule.forRoot reads it when the
    // module is first evaluated.
    const { AppModule } = await import('./app.module.js');

    const app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    try {
      expect(classesBuiltWithoutMetadata(app.get(ModulesContainer))).toEqual([]);
    } finally {
      await app.close();
    }
  }, 60_000);
});

/** Classes that take constructor arguments but carry no `design:paramtypes`. */
function classesBuiltWithoutMetadata(modules: ModulesContainer): string[] {
  const missing = new Set<string>();
  for (const module of modules.values()) {
    for (const wrapper of [...module.providers.values(), ...module.controllers.values()]) {
      const type: unknown = wrapper.metatype;
      // A factory provider's metatype is the factory; its arguments come from
      // `inject`. `ModuleRef` is Nest's own, handed to every module ready-made.
      if (typeof type !== 'function' || wrapper.inject || type === ModuleRef) continue;
      if (type.length === 0) continue;
      if (!Reflect.getMetadata('design:paramtypes', type)) missing.add(type.name);
    }
  }
  return [...missing].sort();
}
