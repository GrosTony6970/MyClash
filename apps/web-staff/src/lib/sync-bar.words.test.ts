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

describe('the bar over a hit or a card the server refused', () => {
  it('says that the rest of its match waits, as it does for a clock press', () => {
    expect(en.scoring.lice.hitsRefused).toMatch(/NOT RECORDED - .*MATCH WAITS\. OPEN REVIEW/);
    expect(fr.scoring.lice.hitsRefused).toMatch(
      /NON ENREGISTRÉE.* - .*ASSAUT ATTEND\. OUVREZ EXAMINER/,
    );
  });
});

describe('the question before a held hit is discarded', () => {
  it('says that the entries that wait behind it are then sent without it', () => {
    expect(en.scoring.quarantine.discardBody).toMatch(/wait behind it are then sent without it/);
    expect(fr.scoring.quarantine.discardBody).toMatch(
      /attendent derrière sont alors envoyées sans elle/,
    );
  });
});

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
