/**
 * The public notice of a Tournament's rules changes, as words: a pure projection over the
 * `rulesetRepins` the page read, so it unit-tests without rendering. `RulesChangesNotice` draws it.
 *
 * Every change is shown, newest first (operator ruling "Public notice"). The changed settings are
 * worded by `rulesChangeLines` (`@myclash/types`), the one value formatter web-admin uses too; a
 * club formula's own values were stripped by the API and read as one line here (`privateFormula`).
 */

import { rulesChangeLines, type RulesChangeNotice } from '@myclash/types';
import { formatInZone, localeToBcp47, type AppLocale } from '@myclash/time';

type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface RulesChangeNoticeItem {
  /** React key only: the notice carries no id. */
  key: string;
  /** "Ruleset changed" or "Settings changed". */
  title: string;
  /** The rules before and after: "TF_v1 1.0.0 → 1.1.0". */
  rules: string;
  /** "Changed on 19 October 2026, 14:05", in the Event's timezone. */
  when: string;
  lines: string[];
  /** "Reason: …", the organiser's words as they typed them. */
  reason: string;
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

/**
 * The rules on each side. A settings change keeps its pair: one label and version. A move inside
 * one ruleset names the label once (operator ruling "Version notice": `TF_v1 1.0.0 → 1.1.0`).
 * A move to another ruleset names both sides, even when the two share a label.
 */
function rulesWords(notice: RulesChangeNotice, t: Translate): string {
  const { fromLabel, fromVersion, toLabel, toVersion } = notice;
  if (!notice.sameRuleset) {
    return t('publicApp.rulesChange.otherRuleset', { fromLabel, fromVersion, toLabel, toVersion });
  }
  if (fromVersion !== toVersion) {
    return t('publicApp.rulesChange.otherVersion', {
      label: toLabel,
      from: fromVersion,
      to: toVersion,
    });
  }
  return t('publicApp.rulesChange.samePair', { label: toLabel, version: toVersion });
}

/** The notices in words, newest first. A tie on the date keeps the order the API sent. */
export function rulesChangesNoticeItems(
  notices: readonly RulesChangeNotice[],
  t: Translate,
  { locale, timezone }: { locale: AppLocale; timezone: string },
): RulesChangeNoticeItem[] {
  return [...notices]
    .sort((a, b) => Date.parse(b.changedAt) - Date.parse(a.changedAt))
    .map((notice, index) => ({
      key: `${notice.changedAt}-${index}`,
      title:
        notice.kind === 'settings'
          ? t('publicApp.rulesChange.settingsChanged')
          : t('publicApp.rulesChange.rulesetChanged'),
      rules: rulesWords(notice, t),
      when: t('publicApp.rulesChange.changedOn', {
        date: formatInZone(notice.changedAt, timezone, DATE_OPTIONS, localeToBcp47(locale)),
      }),
      lines: rulesChangeLines(notice.changes, t, { privateFormula: notice.privateFormula }),
      reason: t('publicApp.rulesChange.reason', { reason: notice.justification }),
    }));
}
