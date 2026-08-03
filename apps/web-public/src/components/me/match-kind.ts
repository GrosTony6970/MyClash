// Shared referee/match-kind helpers for the personal space (/me): the localized
// label for a normalised match-kind token, and the tournament-tab hash a referee
// entry deep-links to. Used by the event Overview page and the Schedule view so
// both read the kind identically.

import type { useI18n } from '@/i18n/I18nProvider';

type TFn = ReturnType<typeof useI18n>['t'];

/** Normalised referee match-kind token → localized label. */
export function matchKindLabel(
  t: TFn,
  kind: string | null,
  roundOfCount: number | null,
  swissRound: number | null = null,
): string | null {
  switch (kind) {
    case 'pool':
      return t('publicApp.me.hub.kindPool');
    case 'play_in':
      return t('publicApp.me.hub.kindPlayIn');
    case 'final':
      return t('publicApp.me.hub.kindFinal');
    case 'semi_final':
      return t('publicApp.me.hub.kindSemiFinal');
    case 'quarter_final':
      return t('publicApp.me.hub.kindQuarterFinal');
    case 'round_of':
      return roundOfCount ? t('publicApp.me.hub.kindRoundOf', { count: roundOfCount }) : null;
    case 'swiss':
      return swissRound
        ? t('publicApp.me.hub.kindSwissRound', { round: swissRound })
        : t('publicApp.me.hub.kindSwiss');
    default:
      return null;
  }
}

/** Referee match-kind → the tournament tab a referee entry should deep-link to.
 *  Pool phases open the Pool List; bracket phases open the Bracket (where the
 *  referee's own match is highlighted); Swiss opens its own Swiss tab — it used
 *  to open Standings, a tab that is HIDDEN for a Swiss-only tournament, so the
 *  link landed on whatever the status default happened to be. Unknown/null keeps
 *  the prior no-hash behaviour (status-based default tab). */
export function matchKindHash(
  kind: string | null,
): '' | '#pools' | '#swiss' | '#standings' | '#bracket' {
  switch (kind) {
    case 'pool':
      return '#pools';
    case 'swiss':
      return '#swiss';
    case 'play_in':
    case 'final':
    case 'semi_final':
    case 'quarter_final':
    case 'round_of':
      return '#bracket';
    default:
      return '';
  }
}
