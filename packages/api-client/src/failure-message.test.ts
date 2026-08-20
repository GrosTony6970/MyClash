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
  { kind: 'unauthenticated', status: 401, detail: null },
  { kind: 'unauthenticated', status: 403, detail: null },
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

  it('sends both unauthenticated statuses to the same string when neither gave a reason', () => {
    const unauthenticated = en('common.apiFailure.unauthenticated');
    expect(failureMessage({ kind: 'unauthenticated', status: 401, detail: null }, en)).toBe(
      unauthenticated,
    );
    expect(failureMessage({ kind: 'unauthenticated', status: 403, detail: null }, en)).toBe(
      unauthenticated,
    );
  });

  it("prefers a 403's own reason — it names what you may not do", () => {
    expect(
      failureMessage(
        { kind: 'unauthenticated', status: 403, detail: 'You are not a referee on this pool' },
        en,
      ),
    ).toBe('You are not a referee on this pool');
  });

  it('ignores a 401 reason — "Unauthorized" says less than our own sentence', () => {
    expect(
      failureMessage({ kind: 'unauthenticated', status: 401, detail: 'Unauthorized' }, en),
    ).toBe(en('common.apiFailure.unauthenticated'));
  });

  it('keeps the two generic failures distinguishable', () => {
    expect(failureMessage({ kind: 'network' }, en)).not.toBe(
      failureMessage({ kind: 'unauthenticated', status: 401, detail: null }, en),
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

  // The API's exception filter fills `detail` on every problem+json body, so a
  // 500 always arrives carrying the scrubbed placeholder rather than nothing.
  // Before this, that placeholder beat the screen's own localised sentence and
  // `fallback` could only be reached via an edge proxy's non-JSON error page.
  const SCRUBBED = 'Internal server error';

  it("lets the screen's own sentence beat a scrubbed 5xx", () => {
    expect(
      failureMessage(
        { kind: 'http', status: 500, detail: SCRUBBED },
        en,
        'Could not save the backup schedule.',
      ),
    ).toBe('Could not save the backup schedule.');
  });

  it('falls to the generic string on a scrubbed 5xx with no fallback', () => {
    expect(failureMessage({ kind: 'http', status: 500, detail: SCRUBBED }, en)).toBe(
      en('common.error'),
    );
  });

  it('keeps a 503 reason — the one ≥500 the filter does not scrub', () => {
    // OperationalUnavailableException: authored for the operator, always a 503.
    expect(
      failureMessage(
        { kind: 'http', status: 503, detail: 'A restore is in progress. Try again shortly.' },
        en,
        'Could not save the backup schedule.',
      ),
    ).toBe('A restore is in progress. Try again shortly.');
  });

  it('still reaches the fallback when a proxy answered with no reason at all', () => {
    // The case that used to be the ONLY way `fallback` was ever seen.
    expect(
      failureMessage({ kind: 'http', status: 502, detail: null }, en, 'Could not load backups.'),
    ).toBe('Could not load backups.');
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
