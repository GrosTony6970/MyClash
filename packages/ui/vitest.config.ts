import { defineConfig } from 'vitest/config';

// See packages/types/vitest.config.ts — without an explicit `include`, Vitest 4
// also collects the compiled CommonJS copies of these tests under dist/, which
// `require('vitest')` and fail outright.
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
