/**
 * A card's colour is said in the reader's language, by one owner.
 *
 * The drawer's three buttons and the card counter's tooltip each held their own
 * English "Yellow / Red / Black".
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cardWord } from './card-word';

const t = (key: string) => key;

describe('the word for a card', () => {
  it('is the i18n key of its colour', () => {
    expect(cardWord('yellow', t)).toBe('scoring.penalties.cards.yellow');
    expect(cardWord('red', t)).toBe('scoring.penalties.cards.red');
    expect(cardWord('black', t)).toBe('scoring.penalties.cards.black');
  });
});

describe('the screens', () => {
  // web-staff has no React test setup: the screens are read as text.
  const read = (name: string) => readFileSync(join(__dirname, '..', 'components', name), 'utf8');

  it.each(['ScoringColumn.tsx', 'MatchCorrectionsDrawer.tsx', 'DirectCardPanel.tsx'])(
    '%s holds no English colour word of its own',
    (name) => {
      expect(read(name)).not.toMatch(/'(Yellow|Red|Black)'/);
    },
  );

  it('the card counter names its colour through the owner', () => {
    expect(read('ScoringColumn.tsx')).toContain('card: cardWord(card, t),');
  });

  it('a direct-card button names its colour through the owner', () => {
    expect(read('DirectCardPanel.tsx')).toContain('{cardWord(card, t)}');
  });
});
