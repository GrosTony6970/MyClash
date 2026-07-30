/**
 * bout-flow-caption.ts — the line of text under the flow chart.
 *
 * Two modes, both naming FIGHTERS rather than colours: what the scrubbed event
 * was, or — with nothing scrubbed — the bout in one sentence. It doubles as the
 * chart's `aria-live` region, which is the only way a screen-reader user reads
 * a scrub at all.
 *
 * Pure: no React.
 */

import type { BoutFlowPoint, BoutFlowSeries } from '../utils/bout-flow';
import { formatMatchClock } from '../utils/format-match-clock';

type Translate = (key: string, params?: Record<string, string>) => string;

/** One scrubbed event: number, clock, both scores, and what it was. */
export function describeBoutFlowPoint(
  p: BoutFlowPoint,
  redName: string,
  blueName: string,
  t: Translate,
): string {
  return [
    p.kind === 'origin' ? t('scoring.boutFlow.start') : `#${p.number}`,
    p.elapsedMs === null ? null : formatMatchClock(p.elapsedMs),
    `${redName} ${p.red} – ${blueName} ${p.blue}`,
    p.card ? t(`scoring.penalties.cards.${p.card}`) : null,
    p.isDouble ? t('scoring.lice.eventRowDouble') : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The bout in one line: how often it turned, and the best run in it. */
export function describeBoutFlow(
  series: BoutFlowSeries,
  redName: string,
  blueName: string,
  t: Translate,
): string {
  return [
    t('scoring.boutFlow.leadChanges', { count: String(series.leadChanges) }),
    series.longestRun
      ? t('scoring.boutFlow.longestRun', {
          points: String(series.longestRun.points),
          name: series.longestRun.side === 'red' ? redName : blueName,
        })
      : null,
    // Doubles are FLAT steps on the chart — invisible, yet in a pool they are
    // what ends the bout at the cap. Say the count out loud.
    series.maxDoubles === null
      ? null
      : t('scoring.boutFlow.doublesCount', {
          count: String(series.doubles),
          max: String(series.maxDoubles),
        }),
    series.doubleLoss ? t('scoring.boutFlow.doubleLoss') : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
