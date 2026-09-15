import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**'],
      // The pure competition core. Floors sit just below coverage measured on 2026-09-15;
      // ratchet upward as coverage improves, never down.
      //
      // This floor does NOT guard the TF_v1 scorer. Some files are tested only from
      // packages/rulesets, which loads this package's built dist, so NO floor measures them and
      // they read low here: src/tf_v1/score.ts (checked by the FAL 2026 golden,
      // packages/rulesets/test/tf_v1.fal2026.test.ts), src/tf_v1/double-penalty.ts,
      // src/formula/evaluator.ts, src/formula/derive-stats.ts and two thirds of
      // src/match-format.ts.
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 85,
        lines: 81,
      },
    },
  },
});
