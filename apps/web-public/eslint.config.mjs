// @ts-check
import rootConfig from '../../eslint.config.mjs';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import noLiteralStringRule from '../../eslint-rules/no-literal-string.mjs';
import noLiteralLocaleRule from '../../eslint-rules/no-literal-locale.mjs';
import noModuleTranslatorRule from '../../eslint-rules/no-module-translator-in-client.mjs';
import noServerApiUrlLeakRule from '../../eslint-rules/no-server-api-url-leak.mjs';
import noRawApiFetchRule from '../../eslint-rules/no-raw-api-fetch.mjs';

export default tseslint.config(
  ...rootConfig,
  // Test files run under vitest (esbuild handles TS) and are excluded
  // from tsconfig — so eslint with parserOptions.project can't parse
  // them. Skip them at the lint boundary.
  { ignores: ['**/*.test.ts', '**/*.test.tsx'] },
  {
    plugins: {
      '@next/next': nextPlugin,
      'react-hooks': reactHooksPlugin,
      'jsx-a11y': jsxA11y,
      myclash: {
        rules: {
          'no-literal-string': noLiteralStringRule,
          'no-literal-locale': noLiteralLocaleRule,
          'no-module-translator-in-client': noModuleTranslatorRule,
          'no-server-api-url-leak': noServerApiUrlLeakRule,
          'no-raw-api-fetch': noRawApiFetchRule,
        },
      },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...Object.fromEntries(
        Object.keys(jsxA11y.flatConfigs.recommended.rules).map((k) => [k, 'error']),
      ),
      'jsx-a11y/label-has-for': 'off',
      'jsx-a11y/label-has-associated-control': 'off',
      'jsx-a11y/control-has-associated-label': 'off',
      'jsx-a11y/no-static-element-interactions': 'off',
      'jsx-a11y/no-noninteractive-element-interactions': 'off',
      'jsx-a11y/no-noninteractive-tabindex': 'off',
      'myclash/no-literal-string': 'error',
      'myclash/no-literal-locale': 'error',
      'myclash/no-module-translator-in-client': 'error',
      // The docker-internal API host must never reach the browser. The rule
      // self-detects 'use client', so it applies to every file.
      'myclash/no-server-api-url-leak': 'error',
      // A ratchet: the existing hand-rolled fetches are baselined, and the list
      // only shrinks. See eslint-rules/no-raw-api-fetch.mjs.
      'myclash/no-raw-api-fetch': 'error',
    },
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Guard against the SSR-hairpin regression: server-side fetches must go
  // through `getServerApiUrl()` (API_URL_INTERNAL) so they don't try to reach
  // the public hostname from inside the docker network, and browser-bound URLs
  // must go through `getPublicApiUrl()`. A direct
  // `process.env['NEXT_PUBLIC_API_URL']` read bypasses both — including the
  // `trimmed()` guard that treats an accidental '' deploy as unset. The helper
  // file itself is the single exception.
  //
  // Scoped to src/** as well as app/**: components live in both, and the
  // app/**-only scope let src/components/PublicPersonalShell.tsx read the env
  // var directly for months.
  {
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    ignores: ['src/lib/api-url.ts', 'src/lib/api-url.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.value='NEXT_PUBLIC_API_URL']",
          message:
            "Don't read NEXT_PUBLIC_API_URL directly — use getPublicApiUrl() (browser-bound) or getServerApiUrl() (SSR fetch) from '@/lib/api-url'. Direct reads bypass the empty-string guard and the server/browser split.",
        },
      ],
    },
  },
);
