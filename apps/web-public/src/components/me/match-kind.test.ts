import { describe, expect, it } from 'vitest';
import { messages } from '@myclash/i18n/public';
import { createTranslator } from '@myclash/i18n/runtime';
import { matchKindLabel } from './match-kind';

const en = createTranslator(messages.en);
const fr = createTranslator(messages.fr);

/** A French referee read "Tableau de 16" for a bout of the round of 16. */
describe('matchKindLabel', () => {
  it('names a round of a bracket by its fraction of the final in French', () => {
    expect(matchKindLabel(fr, 'round_of', 16)).toBe('Huitième de finale');
    expect(matchKindLabel(fr, 'round_of', 32)).toBe('Seizième de finale');
    expect(matchKindLabel(en, 'round_of', 64)).toBe('Round of 64');
  });

  it('names no round when the bout holds no count', () => {
    expect(matchKindLabel(fr, 'round_of', null)).toBeNull();
  });
});
