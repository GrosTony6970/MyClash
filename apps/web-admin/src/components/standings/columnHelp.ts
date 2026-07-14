/**
 * Per-column help text for the standings tables (Pools → Standings and
 * Statistics → Overall ranking). Keyed by the ruleset `StandingsColumn.key`
 * plus the fixed columns (`rank`, `fighter`, `status`). The strings live in
 * i18n (EN + FR) under `organizer.pools.standings.help.*`; this map turns a
 * column key into that i18n key so both tables share one source of truth.
 *
 * Columns without an entry (unknown/custom ruleset keys) get no tooltip.
 */
type Translate = (key: string, values?: Record<string, string | number>) => string;

const HELP_KEY_BASE = 'organizer.pools.standings.help';

const STANDINGS_COLUMN_HELP: Record<string, string> = {
  rank: `${HELP_KEY_BASE}.rank`,
  fighter: `${HELP_KEY_BASE}.fighter`,
  score: `${HELP_KEY_BASE}.score`,
  W: `${HELP_KEY_BASE}.W`,
  L: `${HELP_KEY_BASE}.L`,
  D: `${HELP_KEY_BASE}.D`,
  F: `${HELP_KEY_BASE}.F`,
  ptsScored: `${HELP_KEY_BASE}.ptsScored`,
  ptsConceded: `${HELP_KEY_BASE}.ptsConceded`,
  diff: `${HELP_KEY_BASE}.diff`,
  doubles: `${HELP_KEY_BASE}.doubles`,
  hitsGiven: `${HELP_KEY_BASE}.hitsGiven`,
  hitsReceived: `${HELP_KEY_BASE}.hitsReceived`,
  status: `${HELP_KEY_BASE}.status`,
};

/** Resolve the tooltip text for a column key, or `null` when there is none. */
export function getColumnHelp(key: string, t: Translate): string | null {
  const i18nKey = STANDINGS_COLUMN_HELP[key];
  return i18nKey ? t(i18nKey) : null;
}
