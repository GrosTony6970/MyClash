import { createTranslator, getMessages } from '@myclash/i18n';
import { IMPORT_ROW_REASONS } from '@myclash/types';
import { describe, expect, it } from 'vitest';
import { importProblemText } from './import-reasons';

/**
 * Every code the server can give for an import row has words, in both languages. The list
 * comes from `@myclash/types` at run time, so a code added there reds here until it is worded.
 */
describe('the import reason words', () => {
  it.each(['en', 'fr'] as const)('every code resolves in %s', (locale) => {
    const t = createTranslator(getMessages(locale));
    for (const reason of IMPORT_ROW_REASONS) {
      const text = importProblemText(t, { reason, value: 'x@' });
      expect(text, reason).not.toMatch(/organizer\.personsImport/);
      expect(text, reason).not.toContain('{value}');
      expect(text.length, reason).toBeGreaterThan(0);
    }
  });

  it.each(['en', 'fr'] as const)('words each code its own way in %s', (locale) => {
    const t = createTranslator(getMessages(locale));
    const texts = IMPORT_ROW_REASONS.map((reason) => importProblemText(t, { reason }));
    expect(new Set(texts).size).toBe(IMPORT_ROW_REASONS.length);
  });

  it('names the cell it is about', () => {
    const t = createTranslator(getMessages('en'));
    expect(importProblemText(t, { reason: 'invalid_email', value: 'tom@' })).toBe(
      'This email is not valid: tom@',
    );
    const fr = createTranslator(getMessages('fr'));
    expect(importProblemText(fr, { reason: 'invalid_date_of_birth', value: '03-15-1990' })).toBe(
      'Cette date de naissance est illisible : 03-15-1990 (écrivez JJ/MM/AAAA).',
    );
  });
});
