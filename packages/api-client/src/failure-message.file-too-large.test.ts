import { messages } from '@myclash/i18n/admin';
import { createTranslator } from '@myclash/i18n/runtime';
import { describe, expect, it } from 'vitest';

import type { ApiFailure } from './request';

import { failureMessage } from './failure-message';

const en = createTranslator(messages.en);
const fr = createTranslator(messages.fr);

// Not the catalogue's sentence, so an assertion cannot pass on `detail`.
const API_WORDS = 'Roster import file exceeds the 10 MB size limit.';
const MIB = 1024 * 1024;

/** A 413 as `apiRequest` reads it: the route's English sentence, its code, the limit it read under. */
function refused413(code: string | null, details: Record<string, unknown> | null): ApiFailure {
  return { kind: 'http', status: 413, detail: API_WORDS, code, details, validationErrors: null };
}

/**
 * A file over its route's limit (ruling 207).
 *
 * A French organiser imports a 12 MB roster. The API reads it up to the route's 10 MB limit and
 * refuses it, and the screen showed the API's English sentence.
 */
describe('a file over its route limit (ruling 207)', () => {
  it('is said in the reader’s language, with the limit in MB', () => {
    const failure = refused413('file_too_large', { maxBytes: 10 * MIB });
    expect(failureMessage(failure, fr)).toBe('Ce fichier dépasse la limite de 10 Mo.');
    expect(failureMessage(failure, en)).toBe('This file is larger than the 10 MB limit.');
  });

  it('is said over the sentence of the screen', () => {
    const failure = refused413('file_too_large', { maxBytes: 25 * MIB });
    expect(failureMessage(failure, fr, 'Échec de l’import')).toBe(
      'Ce fichier dépasse la limite de 25 Mo.',
    );
  });

  it('rounds down a limit that is not a whole number of MB', () => {
    // MULTIPART_MAX_BYTES below a route's limit clamps it: 1.6 MiB here, which refuses a 1.7 MiB
    // file. "Larger than the 2 MB limit" would be false.
    const failure = refused413('file_too_large', { maxBytes: 1.6 * MIB });
    expect(failureMessage(failure, en)).toBe('This file is larger than the 1 MB limit.');
  });

  it('keeps the API’s sentence when the limit is missing', () => {
    expect(failureMessage(refused413('file_too_large', null), fr)).toBe(API_WORDS);
    expect(failureMessage(refused413('file_too_large', { maxBytes: '10' }), fr)).toBe(API_WORDS);
  });

  it('keeps the reason of any other 413', () => {
    // busboy's own limits (`FST_PARTS_LIMIT`, `FST_FILES_LIMIT`) and an edge proxy's 413.
    expect(failureMessage(refused413('FST_PARTS_LIMIT', null), fr)).toBe(API_WORDS);
    expect(failureMessage(refused413(null, { maxBytes: 10 * MIB }), fr)).toBe(API_WORDS);
  });
});
