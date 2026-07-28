// @ts-check
import rootConfig from '../../eslint.config.mjs';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import noLiteralStringRule from '../../eslint-rules/no-literal-string.mjs';
import noLiteralLocaleRule from '../../eslint-rules/no-literal-locale.mjs';

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
        },
      },
    },
    rules: {
      // Next.js recommended rules
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // React hooks rules
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
    },
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // The API base URL has one owner: `getPublicApiUrl()` in src/lib/api-url.ts.
  // It was previously copy-pasted as a direct
  // `process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'` read in 121
  // places, and three of them had drifted — two falling back to `''` (relative
  // URLs against an origin with no API on it) and one to no fallback at all,
  // interpolating the string "undefined" into a fetch URL.
  //
  // A direct read also skips the empty-string guard, so a deploy that sets the
  // var to '' passes `??` and breaks silently.
  //
  // Mirrors the same guard in apps/web-public/eslint.config.mjs. Scoped to
  // src/** as well as app/**, because components live in both.
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
            "Don't read NEXT_PUBLIC_API_URL directly — use getPublicApiUrl() from '@/lib/api-url'. Direct reads bypass the empty-string guard and re-scatter the fallback.",
        },
      ],
    },
  },
);
