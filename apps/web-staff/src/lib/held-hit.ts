/**
 * What a held hit's row says about its bout and its Fighters (ruling 243).
 *
 * The refused-hits inbox showed "Clean hit, 14:32" and a reason: nobody could
 * read a held hit out to a super admin after the Event. The names come from the
 * row itself (`OutboxEntry.bout`), saved when the hit was scored.
 *
 * Pure, out of the component: web-staff has no React test setup.
 */

import { kindOf, type BoutNames, type OutboxKind, type RejectedEntry } from '../offline/db';
import type { ClockPress } from '@myclash/types';
import type { ConfirmOptions } from '@myclash/ui';
import { cardWord } from './card-word';
import { heldReason } from './refusal-copy';

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
 * Which round button a held round press is, with its round: "Start round 2",
 * "End round 1". A row that names no button or no round (a broken row) reads
 * as any entry the pad cannot name. No `default`: a third button does not
 * compile.
 */
export function heldRoundLabel(
  held: Pick<RejectedEntry, 'roundAction' | 'round'>,
  t: Translate,
): string {
  if (held.round === undefined) return t('scoring.quarantine.typeUnknown');
  switch (held.roundAction) {
    case 'advance':
      return t('scoring.quarantine.typeRoundAdvance', { round: held.round });
    case 'end':
      return t('scoring.quarantine.typeRoundEnd', { round: held.round });
    case undefined:
      return t('scoring.quarantine.typeUnknown');
  }
}

/**
 * What the bout's screen says at the clock while the inbox holds a row of this
 * bout: what was refused, why, and that what is pressed now waits behind it.
 * Null with no held row. A hit and a card stop their bout as a press does
 * (operator, 2026-10-10), so the official is told the same way.
 */
/** The notice's first sentence, by the kind of the held row. No `default`. */
function heldWhat(held: Pick<RejectedEntry, 'kind'>, t: Translate): string {
  switch (kindOf(held)) {
    case 'press':
      return t('scoring.clock.pressHeld');
    case 'round':
      return t('scoring.clock.roundHeld');
    case 'penalty':
    case 'exchange':
      return t('scoring.clock.entryHeld');
  }
}

export function heldRowNotice(
  held: Pick<RejectedEntry, 'kind' | 'rejectedReason' | 'rejectedCode'> | undefined,
  t: Translate,
): string | null {
  if (!held) return null;
  const what = heldWhat(held, t);
  return `${what} ${heldReason(held, t)} ${t('scoring.clock.pressHeldWaits')}`;
}

/**
 * How many rows of its bout wait behind a held row, or null for none. `t()`
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
const DISCARD_ENTRY = {
  title: 'scoring.quarantine.discardTitle',
  body: 'scoring.quarantine.discardBody',
};
/** The question's title and body, by the kind of the row: a kind with none does not compile. */
const DISCARD_WORDS: Record<OutboxKind, { title: string; body: string }> = {
  exchange: DISCARD_ENTRY,
  penalty: DISCARD_ENTRY,
  press: {
    title: 'scoring.quarantine.discardPressTitle',
    body: 'scoring.quarantine.discardPressBody',
  },
  round: {
    title: 'scoring.quarantine.discardRoundTitle',
    body: 'scoring.quarantine.discardRoundBody',
  },
};

export function discardQuestion(held: Pick<RejectedEntry, 'kind'>, t: Translate): ConfirmOptions {
  const { title, body } = DISCARD_WORDS[kindOf(held)];
  return {
    title: t(title),
    description: t(body),
    confirmLabel: t('scoring.quarantine.discardConfirm'),
    cancelLabel: t('common.cancel'),
    danger: true,
  };
}

/**
 * How many entries "Discard all of this match" takes off the tablet: the rows
 * of the bout the inbox holds, and the rows that wait behind them.
 */
export function boutEntryCount(
  entry: Pick<RejectedEntry, 'matchId'>,
  held: readonly Pick<RejectedEntry, 'matchId'>[],
  waiting: number,
): number {
  return held.filter((row) => row.matchId === entry.matchId).length + waiting;
}

/**
 * The question before every entry of a bout is discarded: one question, with
 * how many go. The button is offered only with a row waiting behind a held
 * one, so the count is two or more and `t()` needs no sentence for one.
 */
export function discardBoutQuestion(count: number, t: Translate): ConfirmOptions {
  return {
    title: t('scoring.quarantine.discardBoutTitle', { count }),
    description: t('scoring.quarantine.discardBoutBody', { count }),
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
