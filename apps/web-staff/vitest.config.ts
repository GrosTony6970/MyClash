import { defineConfig } from 'vitest/config';

export default defineConfig({
  // A test may draw a component on the server renderer (`lice-match-card.test.ts`): the app's
  // tsconfig keeps JSX for Next (`preserve`), so the transform here compiles it itself.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    // This package's own module cache. Vitest wipes the cache when the lockfile changes,
    // and a cache shared by every package is wiped by a dozen runs at once (ENOTEMPTY).
    fsModuleCachePath: 'node_modules/.vitest-cache',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
    },
  },
});
