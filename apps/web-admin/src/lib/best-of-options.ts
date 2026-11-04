import type { Translator } from '@myclash/next-i18n/client';

/**
 * The best-of choices a Match format offers (odd values only: the engine refuses an even N).
 *
 * Keys, not strings: resolved at module init these bound to the EN-only module-level `t`, so the
 * selector read English whatever the organiser chose.
 */
const BEST_OF_OPTIONS = [
  { value: '1', labelKey: 'organizer.tournaments.settings.bestOfSingle' },
  { value: '3', labelKey: 'organizer.tournaments.settings.bestOf3' },
  { value: '5', labelKey: 'organizer.tournaments.settings.bestOf5' },
  { value: '7', labelKey: 'organizer.tournaments.settings.bestOf7' },
] as const;

/**
 * The options of a best-of select, for the Tournament's Match format tab, the wizard and the
 * ruleset editor. `held` are the values the select must be able to show (the value in force, what
 * the ruleset starts from): the engine takes any odd N, so one stored through the API (a 9) is
 * added as a choice of its own rather than shown as the first option.
 */
export function bestOfOptions(
  t: Translator,
  ...held: Array<number | undefined>
): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = BEST_OF_OPTIONS.map((o) => ({
    value: o.value,
    label: t(o.labelKey),
  }));
  for (const n of held) {
    if (n === undefined || options.some((o) => o.value === String(n))) continue;
    options.push({ value: String(n), label: t('organizer.tournaments.settings.bestOfN', { n }) });
  }
  return options.sort((a, b) => Number(a.value) - Number(b.value));
}
