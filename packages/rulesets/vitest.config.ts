import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // This package's own module cache. Vitest wipes the cache when the lockfile changes,
    // and a cache shared by every package is wiped by a dozen runs at once (ENOTEMPTY).
    fsModuleCachePath: 'node_modules/.vitest-cache',
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Highest coverage bar in the monorepo — the scoring engine is the integrity core.
      // Floors sit just below current coverage; ratchet upward as coverage improves, never down.
      thresholds: {
        statements: 78,
        branches: 80,
        functions: 84,
        lines: 78,
      },
    },
  },
});
