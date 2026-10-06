import { messages } from '@myclash/i18n/admin';
import { createTranslator } from '@myclash/i18n/runtime';
import { describe, expect, it } from 'vitest';

import type { ApiFailure } from './request';

import { failureMessage } from './failure-message';

const en = createTranslator(messages.en);
const fr = createTranslator(messages.fr);

// Not the catalogue's sentence, so the English assertion cannot pass on `detail`.
const API_WORDS = 'The lockdown’s own words.';

/** A 503 that keeps its words and its code, as `apiRequest` reads it. */
function answered503(code: string | null): ApiFailure {
  return {
    kind: 'http',
    status: 503,
    detail: API_WORDS,
    code,
    details: null,
    validationErrors: null,
  };
}

/**
 * The maintenance lockdown's refusal (ruling 326).
 *
 * A super admin switches the lockdown on while a French organiser has the admin open. She
 * presses Save on any page: one global check refuses her, and the page showed the API's
 * English sentence.
 */
describe('the maintenance lockdown refusal (ruling 326)', () => {
  it('is said in the reader’s language, by its code', () => {
    expect(failureMessage(answered503('admin_lockdown'), fr)).toBe(
      "MyClash est en maintenance. Seule l'équipe de la plateforme peut y travailler pour le moment. Réessayez plus tard.",
    );
    expect(failureMessage(answered503('admin_lockdown'), en)).toBe(
      'MyClash is in maintenance. Only platform staff can work here for now. Try again later.',
    );
  });

  it('is said over the sentence of the screen', () => {
    expect(failureMessage(answered503('admin_lockdown'), fr, 'Échec de l’enregistrement')).toBe(
      fr('common.apiFailure.adminLockdown'),
    );
  });

  it('leaves every other 503 that kept its words its own reason', () => {
    expect(failureMessage(answered503('signups_disabled'), fr)).toBe(API_WORDS);
    expect(failureMessage(answered503('SERVICE_UNAVAILABLE'), fr)).toBe(API_WORDS);
    expect(failureMessage(answered503(null), fr)).toBe(API_WORDS);
  });
});
