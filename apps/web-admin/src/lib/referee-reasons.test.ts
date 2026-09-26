import { createTranslator, getMessages } from '@myclash/i18n';
import { REFEREE_REASON_CODES } from '@myclash/rulesets/scheduling/referee-checker';
import { describe, expect, it } from 'vitest';
import { refereeReasonText, refereeReasonsText } from './referee-reasons';

/**
 * Every code the checker can give has words, in both languages. The list comes from the
 * checker at run time, so a code added there reds here until it is worded — the i18n
 * sweep alone cannot tell, because a key built from a code is never a literal.
 */
describe('the referee reason words', () => {
  const codes = [...REFEREE_REASON_CODES, 'missing_qualification' as const];

  it.each(['en', 'fr'] as const)('every checker code resolves in %s', (locale) => {
    const t = createTranslator(getMessages(locale));
    for (const code of codes) {
      const line = refereeReasonText(t, code, 'Longsword · A');
      expect(line, code).not.toMatch(/organizer\.refereeBoard/);
      expect(line, code).not.toContain('{against}');
      expect(line.length, code).toBeGreaterThan(0);
    }
  });

  it('names what the reason is against, and leaves it out where there is nothing', () => {
    const t = createTranslator(getMessages('en'));
    expect(refereeReasonText(t, 'fights_overlap', 'Longsword · A')).toBe(
      'fights at the same time (Longsword · A)',
    );
    expect(refereeReasonText(t, 'outside_availability', '')).toBe(
      'outside their declared availability',
    );
    // The cap's `against` is the day's bout total, not a name.
    expect(refereeReasonText(t, 'cap', '9')).toBe('past the daily bout cap (9 bouts that day)');
    expect(refereeReasonText(t, 'rest', 'Longsword · B')).toBe(
      'no rest since another duty (Longsword · B)',
    );
  });

  it('joins several, from a checker reason or a picker reason alike', () => {
    const t = createTranslator(getMessages('en'));
    expect(
      refereeReasonsText(t, [
        { code: 'own_pool', against: { label: 'Pool A' } },
        { code: 'two_roles', label: 'Pool A' },
      ]),
    ).toBe('fights in this Pool (Pool A); already holds another role here (Pool A)');
  });
});
