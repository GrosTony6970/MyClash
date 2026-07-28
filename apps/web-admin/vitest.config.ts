import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Match the Next build's automatic JSX runtime. Without this esbuild falls
  // back to the classic runtime, and any app component under test blows up with
  // "React is not defined" unless it carries an import Next itself doesn't need.
  esbuild: { jsx: 'automatic' },
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
