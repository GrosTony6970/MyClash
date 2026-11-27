/**
 * The label of one ranking rule, e.g. "Score" or "Hits received".
 *
 * A ranking rule names a standings column by its key (`RankingRule.key`). The
 * label of each key lives in i18n under `admin.rulesets.rankingKey_<key>`.
 *
 * There is no fallback. A key with no copy shows as `[admin.rulesets.rankingKey_x]`,
 * and `ranking-key-label.test.ts` fails first: it checks every key a ranking
 * chain can hold, in EN and FR. The old "show the raw key" fallback compared
 * `t(k) === k`, but `t()` answers `[k]` on a miss, so it never ran.
 *
 * Pure: no React, no I/O.
 */
type Translate = (key: string) => string;

export function rankingKeyLabelKey(key: string): string {
  return `admin.rulesets.rankingKey_${key}`;
}

export function rankingKeyLabel(key: string, t: Translate): string {
  return t(rankingKeyLabelKey(key));
}
