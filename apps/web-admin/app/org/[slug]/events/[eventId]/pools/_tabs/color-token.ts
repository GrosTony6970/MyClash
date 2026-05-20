export type ColorToken =
  | 'red'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'purple'
  | 'orange'
  | 'black'
  | 'white';

const MAP: Record<ColorToken, string> = {
  red: 'bg-red-700',
  blue: 'bg-blue-700',
  green: 'bg-green-700',
  yellow: 'bg-yellow-400',
  purple: 'bg-purple-700',
  orange: 'bg-orange-600',
  black: 'bg-slate-900',
  white: 'bg-slate-100',
};

/**
 * Resolve a tournament's configured side-color token into a Tailwind
 * background-color class for the Matches tab column accent. Unknown
 * tokens fall back to `bg-red-700`.
 */
export function accentClassFor(token: ColorToken | string | null | undefined): string {
  if (!token || !(token in MAP)) return MAP.red;
  return MAP[token as ColorToken];
}
