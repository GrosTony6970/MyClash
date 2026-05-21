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

function resolve(token: ColorToken | string | null | undefined): ColorToken {
  if (!token) return 'red';
  return (token in ACCENT_MAP ? token : 'red') as ColorToken;
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
