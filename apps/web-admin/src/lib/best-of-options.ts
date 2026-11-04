/**
 * The best-of choices a Match format offers, for the Tournament's Match format tab and the ruleset
 * editor's box: odd values only (the engine refuses an even N).
 *
 * Keys, not strings: resolved at module init these bound to the EN-only module-level `t`, so the
 * selector read English whatever the organiser chose.
 */
export const BEST_OF_OPTIONS = [
  { value: '1', labelKey: 'organizer.tournaments.settings.bestOfSingle' },
  { value: '3', labelKey: 'organizer.tournaments.settings.bestOf3' },
  { value: '5', labelKey: 'organizer.tournaments.settings.bestOf5' },
  { value: '7', labelKey: 'organizer.tournaments.settings.bestOf7' },
] as const;
