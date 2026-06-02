/**
 * tokens.ts — MyClash design tokens
 *
 * Canonical source of truth for the design language:
 *   - Typography: Cinzel (display/headings) + Inter (body)
 *   - Colors: HEMA red/blue palette + gold accents + neutrals
 *   - Spacing: 4px base grid
 *   - Border radius, shadows, transitions
 *
 * Consumed by:
 *   - CSS variables (tokens.css)
 *   - Tailwind preset (tailwind-preset.ts)
 *   - React components (@myclash/ui)
 */

export const colors = {
  // ── Primary: HEMA Red ──────────────────────────────────────────────────
  red: {
    50: '#fef2f2',
    100: '#fee2e2',
    200: '#fecaca',
    300: '#fca5a5',
    400: '#f87171',
    500: '#ef4444',
    600: '#dc2626',
    700: '#b91c1c',
    800: '#991b1b',
    900: '#7f1d1d',
    950: '#450a0a',
  },

  // ── Secondary: HEMA Blue ───────────────────────────────────────────────
  blue: {
    50: '#eff6ff',
    100: '#dbeafe',
    200: '#bfdbfe',
    300: '#93c5fd',
    400: '#60a5fa',
    500: '#3b82f6',
    600: '#2563eb',
    700: '#1d4ed8',
    800: '#1e40af',
    900: '#1e3a8a',
    950: '#172554',
  },

  // ── Accent: Gold ──────────────────────────────────────────────────────
  gold: {
    50: '#fffbeb',
    100: '#fef3c7',
    200: '#fde68a',
    300: '#fcd34d',
    400: '#fbbf24',
    500: '#f59e0b',
    600: '#d97706',
    700: '#b45309',
    800: '#92400e',
    900: '#78350f',
    950: '#451a03',
  },

  // ── Success / positive: Green (semantic alias backing) ────────────────
  green: {
    50: '#f0fdf4',
    100: '#dcfce7',
    200: '#bbf7d0',
    300: '#86efac',
    400: '#4ade80',
    500: '#22c55e',
    600: '#16a34a',
    700: '#15803d',
    800: '#166534',
    900: '#14532d',
    950: '#052e16',
  },

  // ── Neutrals: Dark slate (scoring/admin dark UI) ───────────────────────
  slate: {
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
    950: '#020617',
  },

  // ── Semantic ───────────────────────────────────────────────────────────
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',
} as const;

export const typography = {
  fontDisplay: '"Cinzel", "Georgia", serif',
  fontBody: '"Inter", "system-ui", sans-serif',
  fontMono: '"JetBrains Mono", "Fira Code", monospace',

  // Scale (rem)
  sizeXs: '0.75rem',
  sizeSm: '0.875rem',
  sizeBase: '1rem',
  sizeLg: '1.125rem',
  sizeXl: '1.25rem',
  size2xl: '1.5rem',
  size3xl: '1.875rem',
  size4xl: '2.25rem',
  size5xl: '3rem',

  weightNormal: '400',
  weightMedium: '500',
  weightSemibold: '600',
  weightBold: '700',
  weightBlack: '900',

  lineHeightTight: '1.25',
  lineHeightNormal: '1.5',
  lineHeightRelaxed: '1.75',
} as const;

export const spacing = {
  px: '1px',
  0: '0',
  0.5: '0.125rem',
  1: '0.25rem',
  1.5: '0.375rem',
  2: '0.5rem',
  2.5: '0.625rem',
  3: '0.75rem',
  3.5: '0.875rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  7: '1.75rem',
  8: '2rem',
  9: '2.25rem',
  10: '2.5rem',
  12: '3rem',
  14: '3.5rem',
  16: '4rem',
  20: '5rem',
  24: '6rem',
  32: '8rem',
  40: '10rem',
  48: '12rem',
  56: '14rem',
  64: '16rem',
} as const;

export const radii = {
  none: '0',
  sm: '0.125rem',
  base: '0.25rem',
  md: '0.375rem',
  lg: '0.5rem',
  xl: '0.75rem',
  '2xl': '1rem',
  '3xl': '1.5rem',
  full: '9999px',
} as const;

export const shadows = {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  base: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  gold: '0 0 20px rgb(245 158 11 / 0.3)',
  red: '0 0 20px rgb(220 38 38 / 0.4)',
} as const;

export const transitions = {
  fast: '150ms ease',
  base: '200ms ease',
  slow: '300ms ease',
  spring: '300ms cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;
