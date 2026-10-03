import { messages } from '@myclash/i18n/admin';
import { createTranslator } from '@myclash/i18n/runtime';
import { describe, expect, it } from 'vitest';

import type { ApiFailure } from './request';

import { failureMessage, isArchivedEventRefusal } from './failure-message';

// The real translators, as in failure-message.test.ts: a missing key answers
// `[the.key]` in both locales, and the "differs" assertion below then fails.
const en = createTranslator(messages.en);
const fr = createTranslator(messages.fr);

// Not the catalogue's sentence, so the English assertion cannot pass on `detail`.
const LOCK_WORDS = 'The lock’s own words.';

/** What the archived-Event lock answers to a write, as `apiRequest` reads it. */
function refused403(code: string | null): ApiFailure {
  return { kind: 'unauthenticated', status: 403, detail: LOCK_WORDS, code, details: null };
}

describe('the archived-Event refusal (ruling 234)', () => {
  it('is said in the reader’s language, by its code', () => {
    expect(failureMessage(refused403('event_archived'), fr)).toBe(
      fr('common.apiFailure.eventArchived'),
    );
    expect(failureMessage(refused403('event_archived'), en)).toBe(
      en('common.apiFailure.eventArchived'),
    );
    expect(fr('common.apiFailure.eventArchived')).not.toBe(en('common.apiFailure.eventArchived'));
  });

  it('leaves every other coded 403 its own reason', () => {
    expect(failureMessage(refused403('FORBIDDEN'), fr)).toBe(LOCK_WORDS);
  });

  it('is told apart by a screen that gives a 403 its own meaning', () => {
    expect(isArchivedEventRefusal(refused403('event_archived'))).toBe(true);
    expect(isArchivedEventRefusal(refused403('FORBIDDEN'))).toBe(false);
    expect(isArchivedEventRefusal({ kind: 'network' })).toBe(false);
  });
});
