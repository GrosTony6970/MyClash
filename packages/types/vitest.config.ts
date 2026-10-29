import { defineConfig } from 'vitest/config';

// Without an explicit `include`, Vitest 4 also collects the compiled copies of
// these same tests under dist/ (tsc emits src/**/*.test.ts alongside the build).
// Those are CommonJS and `require('vitest')`, which Vitest 4 refuses outright.
// Vitest 2 skipped them; matching the include convention the other packages
// already use pins discovery to the TypeScript sources.
export default defineConfig({
  test: {
    // This package's own module cache. Vitest wipes the cache when the lockfile changes,
    // and a cache shared by every package is wiped by a dozen runs at once (ENOTEMPTY).
    fsModuleCachePath: 'node_modules/.vitest-cache',
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
