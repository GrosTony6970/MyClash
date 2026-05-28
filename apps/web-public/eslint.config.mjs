// @ts-check
import rootConfig from '../../eslint.config.mjs';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import noLiteralStringRule from '../../eslint-rules/no-literal-string.mjs';

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
    },
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Guard against the SSR-hairpin regression: server-side fetches must
  // go through `getApiUrl()` (which picks API_URL_INTERNAL on the
  // server) so they don't try to reach the public hostname from inside
  // the docker network. Direct `process.env['NEXT_PUBLIC_API_URL']`
  // reads bypass that branch. The helper file itself is the single
  // exception.
  {
    files: ['app/**/*.{ts,tsx}'],
    ignores: ['src/lib/api-url.ts', 'src/lib/api-url.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.value='NEXT_PUBLIC_API_URL']",
          message:
            "Don't read NEXT_PUBLIC_API_URL directly — use getApiUrl() from '@/lib/api-url'. Direct reads break SSR inside the Docker network (the public hostname doesn't hairpin).",
        },
      ],
    },
  },
);
