import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // This package's own module cache. Vitest wipes the cache when the lockfile changes,
    // and a cache shared by every package is wiped by a dozen runs at once (ENOTEMPTY).
    fsModuleCachePath: 'node_modules/.vitest-cache',
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
  },
});
