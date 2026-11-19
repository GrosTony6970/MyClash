import { describe, expect, it } from 'vitest';
import { createTranslator, getMessages } from '@myclash/i18n';
import { builtInDescription } from './built-in-description';

/** Ruling 891: the built-in FFAMHE plan showed its French seed description on an English screen. */
const SEED = "Plan de compensation officiel FFAMHE (points d'arbitrage)";

describe('builtInDescription', () => {
  it('describes the built-in FFAMHE plan in English on an English screen', () => {
    const en = createTranslator(getMessages('en'));
    expect(builtInDescription({ name: 'FFAMHE', description: SEED }, en)).toBe(
      'The official FFAMHE plan (refereeing points)',
    );
  });

  it('keeps the stored description of a plan it has no words for', () => {
    const en = createTranslator(getMessages('en'));
    expect(builtInDescription({ name: 'Club plan', description: 'Our rates' }, en)).toBe(
      'Our rates',
    );
  });
});
