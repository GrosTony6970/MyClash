/**
 * tailwind-preset.ts — Tailwind CSS v4 preset for MyClash
 *
 * Usage in app tailwind.config.ts:
 *   import preset from '@myclash/design-tokens/tailwind-preset'
 *   export default { presets: [preset], ... }
 */

import { colors, radii, shadows, typography } from './tokens';

const preset = {
  theme: {
    extend: {
      colors: {
        // Brand colors
        brand: {
          red: colors.red,
          blue: colors.blue,
          gold: colors.gold,
          green: colors.green,
          slate: colors.slate,
        },
        // Semantic shortcuts
        primary: colors.red,
        secondary: colors.blue,
        accent: colors.gold,
        // Semantic palette aliases (Slice F.0 — vocabulary only,
        // consumer migration deferred to a separate plan)
        error: colors.red,
        warning: colors.gold,
        success: colors.green,
        info: colors.blue,
      },
      fontFamily: {
        display: [typography.fontDisplay],
        body: [typography.fontBody],
        mono: [typography.fontMono],
        sans: [typography.fontBody],
      },
      borderRadius: radii,
      boxShadow: shadows,
      keyframes: {
        'shield-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        'score-pop': {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.15)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        'shield-pulse': 'shield-pulse 2s ease-in-out infinite',
        'score-pop': 'score-pop 0.3s ease-out',
      },
    },
  },
};

export default preset;
