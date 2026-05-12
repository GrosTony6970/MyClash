import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      all: false,
      reporter: ['text', 'lcov'],
      exclude: [
        '**/*.controller.ts',
        '**/*.module.ts',
        '**/*.dto.ts',
        '**/*.types.ts',
        '**/*.decorator.ts',
        '**/*.guard.ts',
        '**/*.exception.ts',
        'src/main.ts',
        'src/app.module.ts',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
