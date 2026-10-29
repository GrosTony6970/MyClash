import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Match the Next build's automatic JSX runtime.
  //
  // Vite 8 (Vitest 5's peer) transforms with oxc instead of esbuild and
  // ignores the old `esbuild` block outright — it says so on stderr and then
  // carries on. oxc honours tsconfig.json's "jsx": "preserve", which Next
  // requires, so JSX reaches the import analyser untransformed and every .tsx
  // test file dies with "content contains invalid JS syntax". Passing a
  // JsxOptions object here overrides the inherited "preserve".
  oxc: { jsx: { runtime: 'automatic' } },
  // tsconfig.json's `@/*` → `./src/*`, which Next reads and Vite does not by
  // default. Without it, Vite refuses any page that imports `@/…` before a
  // `vi.mock` can apply, so such a page could not be mounted in a test.
  resolve: { tsconfigPaths: true },
  test: {
    // This package's own module cache. Vitest wipes the cache when the lockfile changes,
    // and a cache shared by every package is wiped by a dozen runs at once (ENOTEMPTY).
    fsModuleCachePath: 'node_modules/.vitest-cache',
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['app/**/*.test.ts', 'app/**/*.test.tsx', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
