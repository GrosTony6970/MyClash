import { describe, expect, it } from 'vitest';
import { createTranslator, getMessages } from '@myclash/i18n';
import {
  bracketWords,
  offeredPhaseTypes,
  offeredStrategies,
  offeredValue,
  slotOverrideBody,
} from './bracket-kind';

describe('what the bracket dialogs send for the kind', () => {
  it('sends a hidden pick as the first offered value', () => {
    // A double elimination read from another Tournament's bracket stays in the page's state.
    expect(offeredValue('double_elim', offeredPhaseTypes('team'))).toBe('single_elim');
    expect(offeredValue('by-rating', offeredStrategies('team'))).toBe('snake');
  });

  it('keeps an offered pick', () => {
    expect(offeredValue('double_elim', offeredPhaseTypes('individual'))).toBe('double_elim');
    expect(offeredValue('random', offeredStrategies('team'))).toBe('random');
  });
});

describe('the words that count the entrants of a bracket', () => {
  const en = createTranslator(getMessages('en'));
  const fr = createTranslator(getMessages('fr'));

  it('a team bracket counts teams and is re-created from the teams', () => {
    const words = bracketWords('team');
    expect(en(words.configCount)).toBe('Teams');
    expect(fr(words.configCount)).toBe('Équipes');
    expect(en(words.deleteConfirmHint)).toBe(
      "You can re-create the bracket later from the tournament's teams.",
    );
    expect(fr(words.deleteConfirmHint)).toBe(
      'Vous pourrez recréer le tableau plus tard à partir des équipes du tournoi.',
    );
    expect(en(words.emptyBody)).toContain("the matchups for the tournament's teams.");
    expect(fr(words.emptyBody)).toContain('les rencontres des équipes du tournoi.');
  });

  it('an individual bracket counts fighters', () => {
    const words = bracketWords('individual');
    expect(en(words.configCount)).toBe('Fighters');
    expect(en(words.deleteConfirmHint)).toBe(
      'You can re-create the bracket later from the registered fighters.',
    );
    expect(en(words.emptyBody)).toContain('the matchups for the registered fighters.');
  });
});

describe('slotOverrideBody', () => {
  it('names a team side by its team, and only the changed sides', () => {
    expect(slotOverrideBody('team', 'tm1', undefined)).toEqual({ teamAId: 'tm1' });
    expect(slotOverrideBody('team', undefined, null)).toEqual({ teamBId: null });
  });

  it('names a Fighter side by its Registration', () => {
    expect(slotOverrideBody('individual', 'r1', 'r2')).toEqual({
      registrationAId: 'r1',
      registrationBId: 'r2',
    });
  });
});
