import { defineConfig } from 'vitest/config';

export default defineConfig({
  // A component test mounts React: Next's tsconfig says "jsx": "preserve", which oxc honours
  // unless told otherwise, and `@/…` is Next's alias, not Vite's (apps/web-admin's config says
  // why at length). Such a test asks for its DOM itself (`@vitest-environment jsdom`); the
  // rest run in Node.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { tsconfigPaths: true },
  test: {
    // This package's own module cache. Vitest wipes the cache when the lockfile changes,
    // and a cache shared by every package is wiped by a dozen runs at once (ENOTEMPTY).
    fsModuleCachePath: 'node_modules/.vitest-cache',
  },
});
