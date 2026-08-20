import { messages } from '@myclash/i18n/admin';
import { createTranslator } from '@myclash/i18n/runtime';
import { describe, expect, it } from 'vitest';

import type { ApiFailure } from './request';

import { failureMessage } from './failure-message';

// The real translators, not stubs. A stub would prove the routing and miss the
// thing that actually breaks: a key that resolves to nothing. `t()` answers a
// missing key with `[the.key]`, so an unresolved string is visible, not thrown.
const en = createTranslator(messages.en);
const fr = createTranslator(messages.fr);

const EVERY_FAILURE: ApiFailure[] = [
  { kind: 'network' },
  { kind: 'unauthenticated', status: 401 },
  { kind: 'unauthenticated', status: 403 },
  { kind: 'http', status: 500, detail: null },
  { kind: 'http', status: 409, detail: 'Venue is in use' },
];

describe('failureMessage', () => {
  it('has nothing to say about an abort', () => {
    // The caller's own doing. `null` is what stops every call site from
    // repeating a `kind !== 'aborted'` guard that, on an unsignalled request,
    // could never fire.
    expect(failureMessage({ kind: 'aborted' }, en)).toBeNull();
    expect(failureMessage({ kind: 'aborted' }, en, 'Could not save.')).toBeNull();
  });

  it('sends a network failure to the network string', () => {
    expect(failureMessage({ kind: 'network' }, en)).toBe(en('common.apiFailure.network'));
  });

  it('sends both unauthenticated statuses to the same string', () => {
    const unauthenticated = en('common.apiFailure.unauthenticated');
    expect(failureMessage({ kind: 'unauthenticated', status: 401 }, en)).toBe(unauthenticated);
    expect(failureMessage({ kind: 'unauthenticated', status: 403 }, en)).toBe(unauthenticated);
  });

  it('keeps the two generic failures distinguishable', () => {
    expect(failureMessage({ kind: 'network' }, en)).not.toBe(
      failureMessage({ kind: 'unauthenticated', status: 401 }, en),
    );
  });

  it("reports the API's own reason for a failed response", () => {
    expect(failureMessage({ kind: 'http', status: 409, detail: 'Venue is in use' }, en)).toBe(
      'Venue is in use',
    );
  });

  it('falls back to the generic string when the response gave no reason', () => {
    expect(failureMessage({ kind: 'http', status: 500, detail: null }, en)).toBe(
      en('common.error'),
    );
  });

  it("prefers the caller's own fallback to the generic one", () => {
    expect(
      failureMessage(
        { kind: 'http', status: 500, detail: null },
        en,
        'Could not save the schedule.',
      ),
    ).toBe('Could not save the schedule.');
  });

  it("never lets a fallback bury the server's reason", () => {
    expect(
      failureMessage({ kind: 'http', status: 409, detail: 'Venue is in use' }, en, 'Generic.'),
    ).toBe('Venue is in use');
  });

  it('ignores the fallback for the failures that have their own string', () => {
    expect(failureMessage({ kind: 'network' }, en, 'Generic.')).toBe(
      en('common.apiFailure.network'),
    );
  });

  it('resolves every string it can emit, in en and in fr', () => {
    for (const [locale, t] of [
      ['en', en],
      ['fr', fr],
    ] as const) {
      for (const failure of EVERY_FAILURE) {
        const message = failureMessage(failure, t) ?? '';
        expect(message, `${locale} / ${failure.kind}`).not.toMatch(/^\[.+\]$/);
        expect(message.length, `${locale} / ${failure.kind}`).toBeGreaterThan(0);
      }
    }
  });

  it('says something different in fr than in en', () => {
    expect(failureMessage({ kind: 'network' }, fr)).not.toBe(
      failureMessage({ kind: 'network' }, en),
    );
  });
});
