/**
 * What a held hit's row says about its bout and its Fighters (ruling 243).
 *
 * The refused-hits inbox showed "Clean hit, 14:32" and a reason: nobody could
 * read a held hit out to a super admin after the Event. The names come from the
 * row itself (`OutboxEntry.bout`), saved when the hit was scored.
 *
 * Pure, out of the component: web-staff has no React test setup.
 */

import type { BoutNames, RejectedEntry } from '../offline/db';

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
>;

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
 * Who scored, or which card and who it is against (ruling 246: the card is the
 * penalty-list entry the referee tapped; a row queued before that names only
 * the Fighter). Null for a double, a no-exchange and a card queued before the
 * row knew its corner: there is nobody to name.
 */
export function heldWhoLine(held: Held, t: Translate): string | null {
  if ((held.kind ?? 'exchange') === 'penalty') {
    if (!held.cardedColor) return null;
    const against = t('scoring.quarantine.cardAgainst', {
      who: fighterOf(held, held.cardedColor, t),
    });
    return held.cardName ? `${held.cardName} · ${against}` : against;
  }
  if (!held.firstStrikerColor || held.firstStrikeValue === undefined) return null;
  const who = fighterOf(held, held.firstStrikerColor, t);
  const points = held.firstStrikeValue;
  return held.afterblowValue === undefined
    ? t('scoring.quarantine.scored', { who, points })
    : t('scoring.quarantine.scoredAfterblow', { who, points, afterblow: held.afterblowValue });
}
