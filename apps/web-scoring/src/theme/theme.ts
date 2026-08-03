/**
 * Scoring-app colour theme — the one stored mode, and the two CSS scopes it
 * derives.
 *
 * This app is the only hybrid surface in MyClash: light chrome (match header,
 * corrections drawer, lice lists — read between bouts) over a dark scoring pad
 * (read mid-exchange, under hall lighting). That split used to be HARDCODED —
 * `data-theme="dark"` on <body>, `data-theme="light"` on each chrome region —
 * so it could not be changed at runtime and the operator had no say.
 *
 * Now one mode drives both scopes:
 *
 *   mode      body / pad     chrome
 *   hybrid    dark           light      ← default, byte-identical to the old look
 *   dark      dark           dark
 *   light     light          light
 *
 * `hybrid` reproduces the previous rendering exactly, so a tablet that has
 * never touched the switcher is unchanged by a deploy.
 *
 * Deliberately free of React and `next/*`: the server layout, the client
 * provider and the unit tests all import from here.
 */

export const THEME_COOKIE = 'mc_theme';

export type ScoringTheme = 'hybrid' | 'dark' | 'light';

/** Selectable modes, in switcher order. */
export const SCORING_THEMES = [
  'hybrid',
  'dark',
  'light',
] as const satisfies readonly ScoringTheme[];

export const defaultScoringTheme: ScoringTheme = 'hybrid';

/**
 * The value of the `data-theme` attribute — i.e. which block in
 * packages/ui/src/theme.css wins. Not every mode has its own token set: dark
 * and light are the only two surfaces that exist, and `hybrid` simply points
 * its two regions at different ones.
 */
export type ThemeScope = 'dark' | 'light';

/** Anything unrecognised (stale cookie, hand-edited value) falls back to the default. */
export function parseScoringTheme(raw: string | null | undefined): ScoringTheme {
  return SCORING_THEMES.includes(raw as ScoringTheme) ? (raw as ScoringTheme) : defaultScoringTheme;
}

/** Scope for the scoring pad — and therefore for <body>, which everything inherits. */
export function padScopeFor(mode: ScoringTheme): ThemeScope {
  return mode === 'light' ? 'light' : 'dark';
}

/** Scope for the chrome: header, corrections drawer, lice lists. */
export function chromeScopeFor(mode: ScoringTheme): ThemeScope {
  return mode === 'dark' ? 'dark' : 'light';
}
