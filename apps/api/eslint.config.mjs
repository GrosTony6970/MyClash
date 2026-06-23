// @ts-check
import rootConfig from '../../eslint.config.mjs';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...rootConfig,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ── Enforce: API request validation is Zod-only (nestjs-zod) ──
  // The class-validator -> Zod migration is complete. New class-validator /
  // class-transformer DTOs must not be reintroduced — define request DTOs with
  // `createZodDto(z.object({...}).strict())` instead.
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'class-validator',
              message:
                'API validation uses Zod via nestjs-zod (createZodDto + .strict()). Do not add class-validator DTOs.',
            },
            {
              name: 'class-transformer',
              message:
                'API validation uses Zod via nestjs-zod (createZodDto + .strict()). Do not add class-transformer DTOs.',
            },
          ],
        },
      ],
    },
  },
  // The dispatching pipe's test intentionally imports class-validator to verify
  // the legacy fallback branch still validates non-Zod DTOs.
  {
    files: ['src/common/zod-or-class-validation.pipe.test.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': 'off',
    },
  },
);
