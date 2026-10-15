import type { Translator } from '../types/translator';

/**
 * The word for each standings column a ruleset or the Swiss service can send (quick win O20,
 * operator ruling 2026-10-14): one key per stat, so a French organiser reads "Victoires", not
 * the ruleset's English "Wins". Every key is written whole so the i18n sweep checks each one.
 */
const STAT_WORD: Readonly<Record<string, string>> = {
  score: 'common.standings.score',
  W: 'common.standings.W',
  L: 'common.standings.L',
  D: 'common.standings.D',
  F: 'common.standings.F',
  ptsScored: 'common.standings.ptsScored',
  ptsConceded: 'common.standings.ptsConceded',
  diff: 'common.standings.diff',
  doubles: 'common.standings.doubles',
  hitsGiven: 'common.standings.hitsGiven',
  hitsReceived: 'common.standings.hitsReceived',
  swissPts: 'common.standings.swissPts',
  buchholz: 'common.standings.buchholz',
  buchholzCut1: 'common.standings.buchholzCut1',
  sonnebornBerger: 'common.standings.sonnebornBerger',
  opponentWinPct: 'common.standings.opponentWinPct',
  headToHead: 'common.standings.headToHead',
};

/** Every column key this owner has a word for (its test pins the rulesets' keys to it). */
export const STANDINGS_COLUMN_KEYS: readonly string[] = Object.keys(STAT_WORD);

/**
 * A standings column's title on a screen and in a file: the stat's word in the reader's
 * language, or, for a column no list knows (a custom ruleset's own stat), the ruleset's label.
 */
export function standingsColumnLabel(
  column: { key: string; label: string },
  t: Translator,
): string {
  const key = Object.hasOwn(STAT_WORD, column.key) ? STAT_WORD[column.key] : undefined;
  return key ? t(key) : column.label;
}
