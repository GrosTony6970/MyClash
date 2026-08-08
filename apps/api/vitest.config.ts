import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: [
        '**/*.controller.ts',
        '**/*.module.ts',
        '**/*.dto.ts',
        '**/*.types.ts',
        '**/*.decorator.ts',
        '**/*.guard.ts',
        '**/*.exception.ts',
        'src/main.ts',
        'src/app.module.ts',
      ],
      // A no-regression FLOOR, not a target. Raise it when coverage improves;
      // never lower it to make a red gate green.
      //
      // Vitest 4's v8 provider always applies AST-aware remapping (the opt-in
      // `experimentalAstAwareRemapping` of v3), mapping raw v8 ranges onto real
      // syntax nodes instead of over-crediting them — so these are honest
      // figures rather than the flat 70 that was never genuinely met.
      //
      // Ratcheted 2026-08-08 from 68/69/50/63 after covering the swiss/*
      // loaders and seeding (see swiss-*.test.ts). The margin above measured is
      // deliberately thin — one uncovered file reds this — because that is what
      // a floor is for. Re-measure with `pnpm --filter @myclash/api coverage`
      // and raise all four together; bumping only `branches` lets the other
      // three drift back into staleness.
      //
      // Branches remains the honest weak spot: the pure modules are tested and
      // the Supabase-wrapping Nest services largely are not. Reach for
      // src/common/testing/supabase-chain.ts when closing that gap — the
      // prevailing `from.mockReturnValueOnce(...)` idiom is order-dependent and
      // desyncs silently.
      thresholds: {
        lines: 69,
        functions: 70,
        branches: 51,
        statements: 64,
      },
    },
  },
});
