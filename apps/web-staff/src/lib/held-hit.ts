/**
 * What a held hit's row says about its bout and its Fighters (ruling 243).
 *
 * The refused-hits inbox showed "Clean hit, 14:32" and a reason: nobody could
 * read a held hit out to a super admin after the Event. The names come from the
 * row itself (`OutboxEntry.bout`), saved when the hit was scored.
 *
 * Pure, out of the component: web-staff has no React test setup.
 */

import { kindOf, type BoutNames, type RejectedEntry } from '../offline/db';
import type { ClockPress } from '@myclash/types';
import type { ConfirmOptions } from '@myclash/ui';
import { cardWord } from './card-word';

type Translate = (key: string, values?: Record<string, string | number>) => string;

type Held = Pick<
  RejectedEntry,
  | 'kind'
  | 'bout'
  | 'firstStrikerColor'
  | 'firstStrikeValue'
  | 'afterblowValue'
  | 'cardedColor'
  | 'cardName'
  | 'directCard'
  | 'reason'
>;

/**
 * Which clock button a held press is. A row that names none (a broken row)
 * reads as any entry the pad cannot name. No `default`: a fifth button does
 * not compile.
 */
export function heldPressLabel(action: ClockPress | undefined, t: Translate): string {
  switch (action) {
    case 'start':
      return t('scoring.quarantine.typePressStart');
    case 'halt':
      return t('scoring.quarantine.typePressHalt');
    case 'resume':
      return t('scoring.quarantine.typePressResume');
    case 'end':
      return t('scoring.quarantine.typePressEnd');
    case undefined:
      return t('scoring.quarantine.typeUnknown');
  }
}

/**
 * How many rows of its bout wait behind a held press, or null for none. `t()`
 * has no plural engine, so one row has its own key.
 */
export function heldWaitingLine(count: number, t: Translate): string | null {
  if (count <= 0) return null;
  return count === 1
    ? t('scoring.quarantine.pressWaitingOne')
    : t('scoring.quarantine.pressWaitingMany', { count });
}

/**
 * The question before a held row is discarded.
 *
 * Discarding destroys a hit a referee scored. The only legitimate reason is
 * that it has already been re-entered by hand, so the question says so rather
 * than asking a generic "are you sure". A press is no hit: its question says
 * what its discard does to the rows of its bout that wait behind it.
 */
export function discardQuestion(held: Pick<RejectedEntry, 'kind'>, t: Translate): ConfirmOptions {
  const press = kindOf(held) === 'press';
  return {
    title: press ? t('scoring.quarantine.discardPressTitle') : t('scoring.quarantine.discardTitle'),
    description: press
      ? t('scoring.quarantine.discardPressBody')
      : t('scoring.quarantine.discardBody'),
    confirmLabel: t('scoring.quarantine.discardConfirm'),
    cancelLabel: t('common.cancel'),
    danger: true,
  };
}

/** The names the bout screen shows, for the row a hit of that bout is queued with. */
export function boutNames(match: {
  roundCode?: string;
  matchNumberLabel: string;
  redFighterName?: string;
  blueFighterName?: string;
}): BoutNames {
  return {
    label: match.roundCode || match.matchNumberLabel,
    red: match.redFighterName ?? '',
    blue: match.blueFighterName ?? '',
  };
}

/** "LSW-P1-M3 · Dupont – Martin", with whatever the row holds; null with nothing. */
export function heldBoutLine(held: Held): string | null {
  const bout = held.bout;
  if (!bout) return null;
  const fighters = bout.red && bout.blue ? `${bout.red} – ${bout.blue}` : '';
  return [bout.label, fighters].filter(Boolean).join(' · ') || null;
}

/**
 * A Fighter by name; on a row with no name, by the pad's own word for that side
 * ("Fighter 1": the two sides' colours are the Tournament's to choose).
 */
function fighterOf(held: Held, color: 'red' | 'blue', t: Translate): string {
  const side = color === 'red' ? t('scoring.lice.red') : t('scoring.lice.blue');
  return held.bout?.[color] || side;
}

/**
 * Which card a held row is: the penalty-list entry the referee tapped, or, for a
 * direct card, its colour and the reason the referee typed. The colour is worded
 * when the row is READ, so it follows the reader's language.
 */
function cardOf(held: Held, t: Translate): string | undefined {
  if (!held.directCard) return held.cardName;
  return [cardWord(held.directCard, t), held.reason].filter(Boolean).join(' · ');
}

/**
 * Who scored, or which card and who it is against (ruling 246; a row queued
 * before that names only the Fighter). Null for a double, a no-exchange and a
 * card queued before the row knew its corner: there is nobody to name. Null
 * for a clock press too: it holds no striker, and its label says which button.
 */
export function heldWhoLine(held: Held, t: Translate): string | null {
  if (kindOf(held) === 'penalty') {
    if (!held.cardedColor) return null;
    const against = t('scoring.quarantine.cardAgainst', {
      who: fighterOf(held, held.cardedColor, t),
    });
    const card = cardOf(held, t);
    return card ? `${card} · ${against}` : against;
  }
  if (!held.firstStrikerColor || held.firstStrikeValue === undefined) return null;
  const who = fighterOf(held, held.firstStrikerColor, t);
  const points = held.firstStrikeValue;
  return held.afterblowValue === undefined
    ? t('scoring.quarantine.scored', { who, points })
    : t('scoring.quarantine.scoredAfterblow', { who, points, afterblow: held.afterblowValue });
}
