import { describe, expect, it } from 'vitest';
import { createTranslator, messages } from '@myclash/i18n';
import { boutName } from './round-label';

const en = createTranslator(messages.en);
const fr = createTranslator(messages.fr);
const open = { tournamentName: 'Longsword Open' };

describe('boutName', () => {
  it('keeps the number of a bout that has one', () => {
    expect(boutName({ ...open, label: 'L1-P2-M03', poolName: 'Pool 2' }, en)).toBe('L1-P2-M03');
  });

  it('names a bout with no number by its Tournament and its round, as ruled', () => {
    expect(boutName({ ...open, label: '', roundToken: 'QF', phaseType: 'single_elim' }, en)).toBe(
      'Longsword Open · Quarter Final',
    );
    expect(boutName({ ...open, label: null, poolName: 'Pool 2', phaseType: 'pool' }, en)).toBe(
      'Longsword Open · Pool 2',
    );
    expect(boutName({ ...open, roundToken: 'S3', phaseType: 'swiss' }, fr)).toBe(
      'Longsword Open · Ronde suisse 3',
    );
  });

  it('names its phase when the bout holds no round: one made by hand', () => {
    expect(boutName({ ...open, label: ' ', phaseType: 'double_elim' }, en)).toBe(
      'Longsword Open · Bracket',
    );
    expect(boutName({ ...open, phaseType: 'single_elim' }, fr)).toBe('Longsword Open · Tableau');
    expect(boutName({ ...open, phaseType: 'swiss' }, en)).toBe('Longsword Open · Swiss');
    expect(boutName({ ...open, phaseType: 'pool' }, fr)).toBe('Longsword Open · Poules');
  });

  it('names the Tournament alone when nothing else is known', () => {
    expect(boutName({ ...open, phaseType: null }, en)).toBe('Longsword Open');
  });
});
