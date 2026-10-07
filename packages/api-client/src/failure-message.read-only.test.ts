import { messages } from '@myclash/i18n/admin';
import { createTranslator } from '@myclash/i18n/runtime';
import { describe, expect, it } from 'vitest';

import type { ApiFailure } from './request';

import { failureMessage } from './failure-message';

const en = createTranslator(messages.en);
const fr = createTranslator(messages.fr);

// Not the catalogue's sentence, so the English assertion cannot pass on `detail`.
const API_WORDS = 'The read-only mode’s own words.';

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
 * Read-only mode's refusal (ruling 334).
 *
 * A super admin switches read-only mode on before a database repair. A French organiser
 * presses Save on a Pool: one global check refuses every save, and the page said
 * "Internal server error".
 */
describe('the read-only mode refusal (ruling 334)', () => {
  it('is said in the reader’s language, by its code', () => {
    expect(failureMessage(answered503('read_only_mode'), fr)).toBe(
      'MyClash est en maintenance. Rien ne peut être enregistré pour le moment. Réessayez plus tard.',
    );
    expect(failureMessage(answered503('read_only_mode'), en)).toBe(
      'MyClash is in maintenance. Nothing can be saved for now. Try again later.',
    );
  });

  it('is said over the sentence of the screen', () => {
    expect(failureMessage(answered503('read_only_mode'), fr, 'Échec de l’enregistrement')).toBe(
      fr('common.apiFailure.readOnlyMode'),
    );
  });
});
