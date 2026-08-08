// @ts-check
import rootConfig from '../../eslint.config.mjs';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import noLiteralStringRule from '../../eslint-rules/no-literal-string.mjs';
import noLiteralLocaleRule from '../../eslint-rules/no-literal-locale.mjs';
import noRawPaletteColorRule from '../../eslint-rules/no-raw-palette-color.mjs';

export default tseslint.config(...rootConfig, {
  plugins: {
    '@next/next': nextPlugin,
    'react-hooks': reactHooksPlugin,
    'jsx-a11y': jsxA11y,
    myclash: {
      rules: {
        'no-literal-string': noLiteralStringRule,
        'no-literal-locale': noLiteralLocaleRule,
        'no-raw-palette-color': noRawPaletteColorRule,
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
    // This app is the reason the rule exists — it sets data-theme on <body>,
    // so a raw palette class here silently ignores the scope it renders in.
    'myclash/no-raw-palette-color': 'error',
  },
  languageOptions: {
    parserOptions: {
      project: './tsconfig.json',
      tsconfigRootDir: import.meta.dirname,
    },
  },
});
