import { defineConfig } from 'vitest/config';

// See packages/types/vitest.config.ts — without an explicit `include`, Vitest 4
// also collects the compiled CommonJS copies of these tests under dist/, which
// `require('vitest')` and fail outright.
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // `.tsx` too: NavIcon renders here now that it no longer reads a context,
    // so its render assertion lives beside it instead of in web-admin. Still
    // scoped to `src/`, which is what keeps dist/ out.
    include: ['src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
  },
});
