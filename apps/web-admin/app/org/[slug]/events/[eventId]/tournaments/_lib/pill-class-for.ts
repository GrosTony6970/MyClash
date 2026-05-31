/**
 * Tournament name → tinted pill class pair.
 *
 * Returns a `bg-{color}-100 text-{color}-800` combo so the table
 * cell renders the tournament name inside a pill that matches its
 * configured identity color. Tailwind's JIT will only pick up
 * these classes if the literals appear in source — listing every
 * value explicitly here ensures the safelist behaviour without
 * needing an entry in tailwind.config.
 *
 * Unknown / null colors fall back to a neutral slate pill so the
 * table never renders a missing-class transparent ghost.
 */

const PILL_CLASSES: Record<string, string> = {
  red: 'bg-red-100 text-red-800',
  blue: 'bg-blue-100 text-blue-800',
  green: 'bg-green-100 text-green-800',
  amber: 'bg-amber-100 text-amber-800',
  violet: 'bg-violet-100 text-violet-800',
  teal: 'bg-teal-100 text-teal-800',
  orange: 'bg-orange-100 text-orange-800',
  purple: 'bg-purple-100 text-purple-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  // gold / silver / bronze / black / white aren't standard Tailwind
  // palette names — map them to the closest neutral tint.
  gold: 'bg-amber-100 text-amber-800',
  silver: 'bg-slate-100 text-slate-700',
  bronze: 'bg-orange-100 text-orange-900',
  slate: 'bg-slate-100 text-slate-700',
  black: 'bg-slate-200 text-slate-900',
  white: 'bg-slate-50 text-slate-700 ring-1 ring-slate-200',
};

const FALLBACK = 'bg-slate-100 text-slate-700';

export function pillClassFor(color: string | null | undefined): string {
  if (!color) return FALLBACK;
  return PILL_CLASSES[color] ?? FALLBACK;
}
