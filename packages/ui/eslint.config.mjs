// @ts-check
//
// packages/ui was linted by nothing at all — its package.json script was
// literally `echo 'lint: no sources yet'`. That is how the shared components
// accumulated ~300 raw palette classes and a second, divergent token→hex map,
// while web-scoring (the one app with the rule wired up) stayed clean.
//
// Scope note: the rule matches Tailwind CLASSES only. A raw hex in a lookup
// table still slips through, so `sideStyle` / `sideColorsFor` remain the guard
// for per-tournament fighter colours — see utils/side-color.ts.
import rootConfig from '../../eslint.config.mjs';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import noRawPaletteColorRule from '../../eslint-rules/no-raw-palette-color.mjs';

/**
 * RATCHET — files with pre-existing theme debt, exempted so the gate can go on
 * NOW and catch new code. This list may only shrink; adding to it needs the
 * same justification as any other suppression.
 *
 * Deliberately NOT a blanket disable: the fighter-side colour path
 * (side-color.ts, color-token.ts) is already clean and IS gated, which is the
 * regression this list must never cover. The rest is chrome debt — status
 * fills, dialog borders, brand accents — tracked separately from the
 * configurable-fighter-colour work that turned the rule on.
 */
const PRE_EXISTING_PALETTE_DEBT = [
  'src/components/TVScoreboard.tsx',
  'src/components/MatchScoreboard.tsx',
  'src/components/MatchTimeline.tsx',
  'src/components/LiceWaitingDisplay.tsx',
  'src/components/BracketView.tsx',
  'src/components/bracket/MatchCard.tsx',
  'src/components/bracket/MedalPodium.tsx',
  'src/components/bout-flow-geometry.ts',
  'src/components/AdminPageHeader.tsx',
  'src/components/AiKeyFormDialog.tsx',
  'src/components/BulkActionBar.tsx',
  'src/components/Button.tsx',
  'src/components/ConfirmDialog.tsx',
  'src/components/CountryCombobox.tsx',
  'src/components/Divider.tsx',
  'src/components/FoilMark.tsx',
  'src/components/FormField.tsx',
  'src/components/HelpTooltip.tsx',
  'src/components/Input.tsx',
  'src/components/MaintenanceBanner.tsx',
  'src/components/MetricCard.tsx',
  'src/components/Pill.tsx',
  'src/components/PromptDialog.tsx',
  'src/components/RowActionButton.tsx',
  'src/components/SortableHeader.tsx',
  'src/components/StatusHelp.tsx',
  'src/components/Toast.tsx',
  'src/utils/status-pill.ts',
];

export default tseslint.config(
  ...rootConfig,
  {
    // Tests live outside tsconfig.json's project, so a type-aware parse of them
    // errors before any rule runs.
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
  },
  {
    plugins: {
      // Registered, not enabled: these components are consumed by the Next apps
      // and already carry inline disables written against the app configs.
      // Without the plugins here those comments reference unknown rules and
      // error out.
      '@next/next': nextPlugin,
      'react-hooks': reactHooksPlugin,
      'jsx-a11y': jsxA11y,
      myclash: {
        rules: {
          'no-raw-palette-color': noRawPaletteColorRule,
        },
      },
    },
    // Those plugins' rules stay OFF here — the apps that consume these
    // components run them. So the inline disables are legitimately "unused"
    // from this config's point of view, and reporting them would force us to
    // delete comments the app configs still need.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'myclash/no-raw-palette-color': 'error',
    },
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: PRE_EXISTING_PALETTE_DEBT,
    rules: { 'myclash/no-raw-palette-color': 'off' },
  },
);
