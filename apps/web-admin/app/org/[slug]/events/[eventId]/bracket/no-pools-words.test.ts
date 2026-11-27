import { describe, expect, it } from 'vitest';
import { createTranslator, getMessages } from '@myclash/i18n';
import { bracketWords } from './bracket-kind';

/**
 * An individual bracket with no Pools is seeded in seed order (ruling 991): the seeded Fighters
 * first, lowest seed first, then the others by bib. The confirm before the fill and its button say
 * so, not "registration order". A team bracket says its teams' seed order (`page.team.test.tsx`).
 */
describe('the no-Pools confirm of an individual bracket', () => {
  const { noPoolsBody, noPoolsConfirm } = bracketWords('individual');

  it('says the seed order', () => {
    const t = createTranslator(getMessages('en'));
    expect(t(noPoolsBody)).toBe(
      'This tournament has no pool phase. The bracket will be seeded in seed order: the seeded fighters first, lowest seed first, then the others by bib number. Continue?',
    );
    expect(t(noPoolsConfirm)).toBe('Seed in seed order');
  });

  it('says the seed order in French', () => {
    const t = createTranslator(getMessages('fr'));
    expect(t(noPoolsBody)).toBe(
      "Ce tournoi n'a pas de phase de poules. Le tableau sera classé dans l'ordre des têtes de série : d'abord les combattants classés, du plus petit numéro de tête de série au plus grand, puis les autres par numéro de dossard. Continuer ?",
    );
    expect(t(noPoolsConfirm)).toBe('Classer par têtes de série');
  });
});
