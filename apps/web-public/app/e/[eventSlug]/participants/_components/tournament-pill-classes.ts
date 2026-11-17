import { tintBgClassFor, tintBorderClassFor, tintTextClassFor } from '@myclash/ui';

/**
 * Pill classes for a participant's tournament tag: the configured tournament
 * colour for active registrations (green when none is set), grey for waitlist.
 * The `!t.color` short-circuit keeps the green default — without it the
 * token→class mapping would resolve a null colour to red. The grey is quiet by
 * colour at full ink: faded to 60% it was 2.2:1 (known-deviations D29).
 */
export function tournamentPillClasses(t: {
  color: string | null;
  registrationState: 'active' | 'waitlist';
}): string {
  if (t.registrationState !== 'active') return 'border-stone-300 bg-stone-100 text-slate-600';
  if (!t.color) return 'border-emerald-300 bg-emerald-50 text-emerald-700';
  return `${tintBorderClassFor(t.color)} ${tintBgClassFor(t.color)} ${tintTextClassFor(t.color)}`;
}
