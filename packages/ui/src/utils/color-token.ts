export type ColorToken =
  | 'red'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'purple'
  | 'orange'
  | 'black'
  | 'white'
  | 'amber'
  | 'violet'
  | 'teal'
  | 'gold'
  | 'silver'
  | 'bronze'
  | 'slate';

// raw-color-exempt — a token→class map IS the palette definition; see side-color.ts.
const ACCENT_MAP: Record<ColorToken, string> = {
  red: 'bg-red-700',
  blue: 'bg-blue-700',
  green: 'bg-green-700',
  yellow: 'bg-yellow-400',
  purple: 'bg-purple-700',
  orange: 'bg-orange-600',
  black: 'bg-slate-900',
  white: 'bg-slate-100',
  amber: 'bg-amber-600',
  violet: 'bg-violet-700',
  teal: 'bg-teal-700',
  gold: 'bg-amber-400',
  silver: 'bg-slate-300',
  bronze: 'bg-amber-700',
  slate: 'bg-slate-400',
};

// raw-color-exempt — a token→class map IS the palette definition; see side-color.ts.
const TINT_BG_MAP: Record<ColorToken, string> = {
  red: 'bg-red-50',
  blue: 'bg-blue-50',
  green: 'bg-green-50',
  yellow: 'bg-yellow-50',
  purple: 'bg-purple-50',
  orange: 'bg-orange-50',
  black: 'bg-slate-100',
  white: 'bg-slate-50',
  amber: 'bg-amber-50',
  violet: 'bg-violet-50',
  teal: 'bg-teal-50',
  gold: 'bg-amber-100',
  silver: 'bg-slate-100',
  bronze: 'bg-amber-50',
  slate: 'bg-slate-50',
};

// raw-color-exempt — a token→class map IS the palette definition; see side-color.ts.
const TINT_TEXT_MAP: Record<ColorToken, string> = {
  red: 'text-red-700',
  blue: 'text-blue-700',
  green: 'text-green-700',
  yellow: 'text-yellow-800',
  purple: 'text-purple-700',
  orange: 'text-orange-700',
  black: 'text-slate-900',
  white: 'text-slate-700',
  amber: 'text-amber-700',
  violet: 'text-violet-700',
  teal: 'text-teal-700',
  gold: 'text-amber-900',
  silver: 'text-slate-700',
  bronze: 'text-amber-800',
  slate: 'text-slate-600',
};

// Matches TINT_TEXT_MAP's shade values one-for-one so the active-tab
// underline + section-title text-colour pair visually. Listed as
// literal strings (rather than runtime `text.replace`) so Tailwind's
// content scanner picks each class up.
// raw-color-exempt — palette definition, as above.
const TINT_BORDER_MAP: Record<ColorToken, string> = {
  red: 'border-red-700',
  blue: 'border-blue-700',
  green: 'border-green-700',
  yellow: 'border-yellow-800',
  purple: 'border-purple-700',
  orange: 'border-orange-700',
  black: 'border-slate-900',
  white: 'border-slate-700',
  amber: 'border-amber-700',
  violet: 'border-violet-700',
  teal: 'border-teal-700',
  gold: 'border-amber-900',
  silver: 'border-slate-700',
  bronze: 'border-amber-800',
  slate: 'border-slate-600',
};

/**
 * Unknown/missing tokens resolve to `slate`, not to a colour with meaning.
 *
 * These helpers paint fighter sides in the bracket as well as tournament and
 * workshop identity. Defaulting to `red` meant a bracket slot whose side colour
 * failed to load painted BOTH fighters red — the exact assumption the
 * per-tournament `sideColors` config exists to remove. A neutral grey reads as
 * "no colour set" instead of asserting one.
 */
function resolve(token: ColorToken | string | null | undefined): ColorToken {
  if (!token) return 'slate';
  return (token in ACCENT_MAP ? token : 'slate') as ColorToken;
}

/**
 * Narrow an arbitrary colour string to a `ColorToken`.
 *
 * Exists because `TournamentSideColor` and `ColorToken` are NOT the same set —
 * a tournament may be configured `grey`, `brown` or `pink`, none of which is a
 * token. Call sites used to paper over that with `as ColorToken`, a cast that
 * is simply false for those three. This returns the real thing, falling back to
 * `slate` exactly as every other helper here does.
 */
export function asColorToken(token: ColorToken | string | null | undefined): ColorToken {
  return resolve(token);
}

/** Solid background class (used for color stripes and accent blocks). */
export function accentClassFor(token: ColorToken | string | null | undefined): string {
  return ACCENT_MAP[resolve(token)];
}

/** Soft tint background class (used for score boxes, pill backgrounds). */
export function tintBgClassFor(token: ColorToken | string | null | undefined): string {
  return TINT_BG_MAP[resolve(token)];
}

/** Tint-paired text color class (used for pill text on a tinted background). */
export function tintTextClassFor(token: ColorToken | string | null | undefined): string {
  return TINT_TEXT_MAP[resolve(token)];
}

/** Tint-paired border color class (matches tintTextClassFor's shade). */
export function tintBorderClassFor(token: ColorToken | string | null | undefined): string {
  return TINT_BORDER_MAP[resolve(token)];
}
