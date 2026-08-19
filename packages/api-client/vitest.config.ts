import { defineConfig } from 'vitest/config';

// See packages/types/vitest.config.ts — without an explicit `include`, Vitest 4
// also collects the compiled CommonJS copies of these tests under dist/, which
// `require('vitest')` and fail outright.
//
// `passWithNoTests` is false on purpose, unlike the packages/time template it
// otherwise copies. This package's whole point is that it finally has tests; an
// empty run has to be red, and the package script cannot see this setting to
// override it.
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: false,
  },
});
