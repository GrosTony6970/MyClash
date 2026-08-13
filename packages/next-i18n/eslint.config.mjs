// @ts-check
//
// Without a config here, `eslint src` walks up to the root one — which has no
// `parserOptions.project`, so every type-aware rule throws getParserServices
// before it runs a single check. Same shape as packages/ui's config, minus the
// palette-debt ratchet: this package is two files old and has none.
import rootConfig from '../../eslint.config.mjs';
import tseslint from 'typescript-eslint';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import noRawPaletteColorRule from '../../eslint-rules/no-raw-palette-color.mjs';

export default tseslint.config(...rootConfig, {
  plugins: {
    'react-hooks': reactHooksPlugin,
    myclash: {
      rules: {
        'no-raw-palette-color': noRawPaletteColorRule,
      },
    },
  },
  rules: {
    // This package defines the provider and the hook every app's client
    // components consume, and no app config lints it — so the hook rules run
    // here rather than nowhere. packages/ui registers these plugins but
    // leaves them off; it has 34 client modules of pre-existing debt to
    // ratchet through first, and this one has none.
    ...reactHooksPlugin.configs.recommended.rules,
    'myclash/no-raw-palette-color': 'error',
  },
  languageOptions: {
    parserOptions: {
      project: './tsconfig.json',
      tsconfigRootDir: import.meta.dirname,
    },
  },
});
