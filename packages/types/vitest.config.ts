import { defineConfig } from 'vitest/config';

// Without an explicit `include`, Vitest 4 also collects the compiled copies of
// these same tests under dist/ (tsc emits src/**/*.test.ts alongside the build).
// Those are CommonJS and `require('vitest')`, which Vitest 4 refuses outright.
// Vitest 2 skipped them; matching the include convention the other packages
// already use pins discovery to the TypeScript sources.
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
