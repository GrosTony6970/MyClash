import type { ApiFailure } from '@myclash/api-client';
import { createTranslator } from '@myclash/i18n/runtime';
import { messages } from '@myclash/i18n/staff';
import { describe, expect, it } from 'vitest';

import { refusedUndoWords } from './refused-undo';

/**
 * What the bout screen says of an undo the server refused later (ruling 354).
 *
 * He undid hit 5 with no connection. Before the wifi came back the Event was
 * closed, so the server refused the void. Hit 5 is on the list again, and he
 * took it off: the screen says it was refused and that it is back, then why
 * when the pad has its own words for the server's code.
 */
const API_WORDS = 'Match is locked';
const refusal = (status: number, code: string): ApiFailure => ({
  kind: 'http',
  status,
  code,
  detail: API_WORDS,
  details: null,
  validationErrors: null,
});

describe.each([
  ['en', messages.en],
  ['fr', messages.fr],
] as const)('refusedUndoWords, %s', (_locale, tree) => {
  const t = createTranslator(tree);
  const said = t('scoring.corrections.earlierUndoRefused');

  it('has its sentence in this language', () => {
    expect(said).not.toContain('scoring.corrections');
  });

  it('says the refusal, then the pad’s own words for a code it knows', () => {
    const words = refusedUndoWords(refusal(409, 'event_results_frozen'), t);

    expect(words).toBe(`${said} ${t('scoring.corrections.eventOver')}`);
  });

  // A locked bout answers 400 `BAD_REQUEST` with an English sentence of the API.
  it('says the refusal alone for a code it does not know, never the words of the API', () => {
    const words = refusedUndoWords(refusal(400, 'BAD_REQUEST'), t);

    expect(words).toBe(said);
    expect(words).not.toContain(API_WORDS);
  });
});
