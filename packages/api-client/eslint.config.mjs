// @ts-check
import rootConfig from '../../eslint.config.mjs';
import tseslint from 'typescript-eslint';

/**
 * The root config turns on type-aware rules (`no-floating-promises`,
 * `no-misused-promises`) but wires no TypeScript project, so `eslint src` in a
 * package dies with "you have used a rule which requires type information"
 * before it lints a line. Every app config answers that with its own
 * `parserOptions.project`; the shared packages answered it by not linting at
 * all — `"lint": "echo 'lint: no sources yet'"`, which stopped being true here
 * the moment this package grew a hand-written fetch owner.
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
