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
  'kind' | 'bout' | 'firstStrikerColor' | 'firstStrikeValue' | 'afterblowValue' | 'cardedColor'
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

/** A Fighter by name and corner, or by the corner alone on a row with no name. */
function fighterOf(held: Held, color: 'red' | 'blue', t: Translate): string {
  const corner = color === 'red' ? t('scoring.lice.red') : t('scoring.lice.blue');
  const name = held.bout?.[color];
  return name ? `${name} (${corner})` : corner;
}

/**
 * Who scored, or who the card is against. Null for a double, a no-exchange and
 * a card queued before the row knew its corner: there is nobody to name.
 */
export function heldWhoLine(held: Held, t: Translate): string | null {
  if ((held.kind ?? 'exchange') === 'penalty') {
    return held.cardedColor
      ? t('scoring.quarantine.cardAgainst', { who: fighterOf(held, held.cardedColor, t) })
      : null;
  }
  if (!held.firstStrikerColor || held.firstStrikeValue === undefined) return null;
  const who = fighterOf(held, held.firstStrikerColor, t);
  const points = held.firstStrikeValue;
  return held.afterblowValue === undefined
    ? t('scoring.quarantine.scored', { who, points })
    : t('scoring.quarantine.scoredAfterblow', { who, points, afterblow: held.afterblowValue });
}
