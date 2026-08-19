// @ts-check
import rootConfig from '../../eslint.config.mjs';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import noLiteralStringRule from '../../eslint-rules/no-literal-string.mjs';
import noLiteralLocaleRule from '../../eslint-rules/no-literal-locale.mjs';
import noModuleTranslatorRule from '../../eslint-rules/no-module-translator-in-client.mjs';
import noRawPaletteColorRule from '../../eslint-rules/no-raw-palette-color.mjs';
import noRawApiFetchRule from '../../eslint-rules/no-raw-api-fetch.mjs';

export default tseslint.config(
  ...rootConfig,
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
          'no-raw-palette-color': noRawPaletteColorRule,
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
      // This app is the reason the rule exists — it sets data-theme on <body>,
      // so a raw palette class here silently ignores the scope it renders in.
      'myclash/no-raw-palette-color': 'error',
      // A ratchet: the existing hand-rolled fetches are baselined and the list
      // only shrinks. src/offline/** is permanently exempt — `fetchWithCache`
      // has to keep the pad scoring with no network at all, which is a
      // different job from the seam's. See eslint-rules/no-raw-api-fetch.mjs.
      'myclash/no-raw-api-fetch': 'error',
    },
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // The API base URL has one owner: src/lib/api-url.ts — `getApiUrl()` for a
  // client module, `BROWSER_API_BASE` for a Server Component that has to hand
  // the value to one.
  //
  // This app is the reason to say it twice. Its browser policy is same-origin
  // ('') so the scoring bundle works at staff.${DOMAIN} AND behind
  // admin.${DOMAIN}/staff/* from one image; a direct read gets the ABSOLUTE
  // build-time host instead, which is a different origin under at least one of
  // those mounts and, in this deploy, one whose cert the browser rejects. That
  // is not a loud failure — the flags fetch is caught and discarded — so
  // app/layout.tsx shipped it silently until 2026-08-13.
  //
  // A direct read also skips the empty-string guard. Mirrors the same guard in
  // apps/web-admin and apps/web-public. Scoped to src/** as well as app/**,
  // because components live in both.
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
            "Don't read NEXT_PUBLIC_API_URL directly — use getApiUrl() from '../src/lib/api-url' in a client module, or BROWSER_API_BASE from the same file in a Server Component. A direct read yields the absolute build-time host, which breaks the pad's same-origin mount and bypasses the empty-string guard.",
        },
      ],
    },
  },
);
