import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Match the Next build's automatic JSX runtime.
  //
  // Vite 8 (pulled in by Vitest 4) transforms with oxc instead of esbuild and
  // ignores the old `esbuild` block outright — it says so on stderr and then
  // carries on. oxc honours tsconfig.json's "jsx": "preserve", which Next
  // requires, so JSX reaches the import analyser untransformed and every .tsx
  // test file dies with "content contains invalid JS syntax". Passing a
  // JsxOptions object here overrides the inherited "preserve".
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['app/**/*.test.ts', 'app/**/*.test.tsx', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
