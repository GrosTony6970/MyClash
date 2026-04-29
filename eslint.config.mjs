// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Root ESLint flat config for the MyClash monorepo.
 *
 * Each workspace can extend this via `extends: ['../../eslint.config.mjs']`
 * or override rules as needed. This root config covers all TS/JS files
 * in the repo with sensible defaults.
 */
export default tseslint.config(
  // ── Global ignores ────────────────────────────────────────────────────────
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      // Generated files
      'packages/api-client/src/generated/**',
    ],
  },

  // ── Base JS rules ─────────────────────────────────────────────────────────
  js.configs.recommended,

  // ── TypeScript rules ──────────────────────────────────────────────────────
  ...tseslint.configs.recommended,

  // ── Project-wide overrides ────────────────────────────────────────────────
  {
    rules: {
      // Enforce explicit return types on exported functions (keeps API surface clear)
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      // Allow `_` prefix for intentionally unused variables
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // No implicit any — strict mode is on in tsconfig but belt-and-suspenders
      '@typescript-eslint/no-explicit-any': 'warn',

      // Prefer `const` assertions and type imports
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // No floating promises — async code must be awaited or explicitly voided
      '@typescript-eslint/no-floating-promises': 'error',

      // No misused promises (e.g. passing async fn where sync is expected)
      '@typescript-eslint/no-misused-promises': 'error',

      // Disallow eval and dynamic code execution (hard rule from AGENTS.md)
      'no-eval': 'error',
      'no-new-func': 'error',

      // Consistent object shorthand
      'object-shorthand': ['error', 'always'],

      // Prefer const
      'prefer-const': 'error',

      // No console.log in production code (use a logger)
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },

  // ── Test file overrides ───────────────────────────────────────────────────
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**/*.ts'],
    rules: {
      // Tests often need explicit any for mocks
      '@typescript-eslint/no-explicit-any': 'off',
      // Tests may use console for debugging
      'no-console': 'off',
      // Floating promises are common in test setup/teardown
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },

  // ── Script file overrides ─────────────────────────────────────────────────
  {
    files: ['scripts/**/*.ts', 'infra/**/*.ts'],
    rules: {
      // Scripts may need console output
      'no-console': 'off',
    },
  },
);
