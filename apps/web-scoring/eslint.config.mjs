// @ts-check
import rootConfig from '../../eslint.config.mjs';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import noLiteralStringRule from '../../eslint-rules/no-literal-string.mjs';

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
        },
      },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...Object.fromEntries(
        Object.keys(jsxA11y.flatConfigs.recommended.rules).map((k) => [k, 'warn']),
      ),
      'myclash/no-literal-string': 'error',
    },
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
