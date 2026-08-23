// @ts-check
import rootConfig from '../../eslint.config.mjs';
import tseslint from 'typescript-eslint';

/**
 * The root config turns on type-aware rules (`no-floating-promises`,
 * `no-misused-promises`) but wires no TypeScript project, so `eslint src` in a
 * package dies with "you have used a rule which requires type information"
 * before it lints a line. Every app config answers that with its own
 * `parserOptions.project`; `packages/api-client` is the shared-package
 * precedent.
 *
 * This package lints from its first commit deliberately. The rest of the shared
 * packages still declare `"lint": "echo 'lint: no sources yet'"`, so
 * `turbo run lint` skips them entirely — and slice 5 of the extraction moves
 * ~1,200 lines here out of `apps/api`, which lints `{src,test}/**\/*.ts` with
 * `--max-warnings 0`. Copying `packages/types`' manifest would have dropped that
 * code out of eslint's reach without anything going red.
 */
export default tseslint.config(...rootConfig, {
  files: ['src/**/*.ts'],
  languageOptions: {
    parserOptions: {
      project: './tsconfig.json',
      tsconfigRootDir: import.meta.dirname,
    },
  },
});
