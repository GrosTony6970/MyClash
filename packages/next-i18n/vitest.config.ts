import { defineConfig } from 'vitest/config';

// See packages/ui/vitest.config.ts — without an explicit `include`, Vitest 4
// also collects the compiled CommonJS copies of these tests under dist/, which
// `require('vitest')` and fail outright.
export default defineConfig({
  test: {
    // This package's own module cache. Vitest wipes the cache when the lockfile changes,
    // and a cache shared by every package is wiped by a dozen runs at once (ENOTEMPTY).
    fsModuleCachePath: 'node_modules/.vitest-cache',
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
  },
});
