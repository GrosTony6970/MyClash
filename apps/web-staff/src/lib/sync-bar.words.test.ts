/**
 * The bar's four "not sent" sentences name what the tablet's queue holds
 * (operator, 2026-10-10).
 *
 * The queue holds hits, cards and clock presses. The sentences said "HITS NOT
 * SENT", also when only a Pause waited. They say "entries", the word the
 * sign-in screen already uses for the same rows.
 */
import { describe, expect, it } from 'vitest';
import { en, fr } from '@myclash/i18n';

const KEYS = ['sessionEnded', 'accountCannotScore', 'pinDisabled', 'pinRoleCannotScore'] as const;

describe('the bar, while the queue waits for somebody who may send it', () => {
  it.each(KEYS)('%s says "entries not sent" in English', (key) => {
    expect(en.scoring.lice[key]).toContain(' - ENTRIES NOT SENT. ');
    expect(en.scoring.lice[key]).not.toMatch(/HITS/);
  });

  it.each(KEYS)('%s says "saisies non envoyées" in French', (key) => {
    expect(fr.scoring.lice[key]).toContain(' - SAISIES NON ENVOYÉES. ');
    expect(fr.scoring.lice[key]).not.toMatch(/TOUCHES/);
  });
});
