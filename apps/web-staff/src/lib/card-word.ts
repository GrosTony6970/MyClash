/**
 * A card's colour, in the reader's language.
 *
 * Three whole literal keys, not a key built from the colour: the i18n sweep
 * reads literals, and a built key hides an orphan from it.
 */

import type { PenaltyCard } from '@myclash/types';

type Translate = (key: string) => string;

export function cardWord(card: PenaltyCard, t: Translate): string {
  switch (card) {
    case 'yellow':
      return t('scoring.penalties.cards.yellow');
    case 'red':
      return t('scoring.penalties.cards.red');
    case 'black':
      return t('scoring.penalties.cards.black');
  }
}
