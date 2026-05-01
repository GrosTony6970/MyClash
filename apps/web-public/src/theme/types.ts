/**
 * Theme types for per-event theming (T-602).
 */

export interface EventTheme {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  heroImageUrl: string | null;
  fontDisplay: string;
  fontBody: string;
  customCss: string | null;
}

/** Default theme — used when event has no custom theme. */
export const DEFAULT_THEME: EventTheme = {
  primaryColor: '#c0392b',
  secondaryColor: '#2c3e50',
  accentColor: '#f59e0b',
  logoUrl: null,
  heroImageUrl: null,
  fontDisplay: 'Cinzel',
  fontBody: 'Inter',
  customCss: null,
};
