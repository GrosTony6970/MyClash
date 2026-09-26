import { createTranslator, getMessages } from '@myclash/i18n';
import { REFEREE_REASON_CODES } from '@myclash/rulesets/scheduling/referee-checker';
import { describe, expect, it } from 'vitest';
import { formatUnassignedReason } from './format-unassigned-reason';

const identity = (key: string) => key;

describe('formatUnassignedReason', () => {
  // The list comes from the checker at run time: a code added there reds here until worded.
  const codes = ['no_qualified_users', 'all_qualified_already_seated', ...REFEREE_REASON_CODES];

  it.each(['en', 'fr'] as const)('words every code auto-assign can give, in %s', (locale) => {
    const t = createTranslator(getMessages(locale));
    for (const code of codes) {
      const line = formatUnassignedReason(code, t);
      expect(line, code).not.toMatch(/organizer\.refereesPage|_/);
      // `rest` and `cap` have no underscore: the raw fallback would pass the line above.
      expect(line, code).not.toBe(code);
      expect(line.length, code).toBeGreaterThan(0);
    }
  });

  it('maps a code to its own key', () => {
    expect(formatUnassignedReason('rest', identity)).toBe(
      'organizer.refereesPage.unassignedReasons.rest',
    );
  });

  it('falls back to the raw code when no i18n mapping exists', () => {
    expect(formatUnassignedReason('something_new_we_did_not_translate', identity)).toBe(
      'something_new_we_did_not_translate',
    );
  });
});
