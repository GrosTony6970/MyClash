import { describe, expect, it } from 'vitest';
import type { TranslatorValues } from '../types/translator';
import { nameOrUnknown } from './name-or-unknown';

const t = (key: string, values?: TranslatorValues) =>
  values ? `${key} ${JSON.stringify(values)}` : key;

describe('nameOrUnknown', () => {
  it('gives the name, trimmed', () => {
    expect(nameOrUnknown('  Léa Martin ', 'fighter', t, 12)).toBe('Léa Martin');
    expect(nameOrUnknown('Jo', 'referee', t)).toBe('Jo');
  });

  it('words a fighter with no name, with the bib when the Registration has one', () => {
    expect(nameOrUnknown('', 'fighter', t, 12)).toBe(
      'common.unknownName.fighterWithBib {"bib":12}',
    );
    expect(nameOrUnknown(' ', 'fighter', t, 0)).toBe('common.unknownName.fighterWithBib {"bib":0}');
    expect(nameOrUnknown(null, 'fighter', t)).toBe('common.unknownName.fighter');
    expect(nameOrUnknown(undefined, 'fighter', t, null)).toBe('common.unknownName.fighter');
  });

  it('words a referee and a person with no name, and never shows a bib for them', () => {
    expect(nameOrUnknown('', 'referee', t, 12)).toBe('common.unknownName.referee');
    expect(nameOrUnknown(null, 'person', t, 12)).toBe('common.unknownName.person');
  });
});
