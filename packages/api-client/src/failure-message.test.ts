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
  // Both shapes: a bare body reaches the intermediary string, one carrying a
  // code reaches the session string. Without the second, the locale sweep below
  // would stop covering `common.apiFailure.unauthenticated` entirely.
  { kind: 'unauthenticated', status: 401, detail: null, code: null, details: null },
  { kind: 'unauthenticated', status: 403, detail: null, code: null, details: null },
  { kind: 'unauthenticated', status: 401, detail: null, code: 'UNAUTHORIZED', details: null },
  { kind: 'http', status: 500, detail: null, validationErrors: null, code: null, details: null },
  // The throttled request. This array is the ONLY input to the en/fr sweep at
  // the bottom of this file, so without an entry here
  // `common.apiFailure.tooManyRequests` would ship unswept in both locales.
  {
    kind: 'http',
    status: 429,
    detail: 'ThrottlerException: Too many requests',
    validationErrors: null,
    code: null,
    details: null,
  },
  {
    kind: 'http',
    status: 409,
    detail: 'Venue is in use',
    validationErrors: null,
    code: null,
    details: null,
  },
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

  it('sends both unauthenticated statuses to the same string when the API gave no reason', () => {
    const unauthenticated = en('common.apiFailure.unauthenticated');
    // `code` present, `detail` absent: still the API answering, just without a
    // sentence. Only a body carrying NEITHER is an intermediary — see below.
    expect(
      failureMessage(
        { kind: 'unauthenticated', status: 401, detail: null, code: 'FORBIDDEN', details: null },
        en,
      ),
    ).toBe(unauthenticated);
    expect(
      failureMessage(
        { kind: 'unauthenticated', status: 403, detail: null, code: 'FORBIDDEN', details: null },
        en,
      ),
    ).toBe(unauthenticated);
  });

  // The API fills `detail` and `code` on every problem+json body, so a 401/403
  // carrying neither did not come from the API — an edge proxy, a jail or a
  // captive portal answered for it. Those are transient, and "your session
  // expired, sign in again" sends the operator to a screen that cannot help.
  it.each([401, 403] as const)(
    'calls a %i with no problem+json body an intermediary, not a dead session',
    (status) => {
      expect(
        failureMessage(
          { kind: 'unauthenticated', status, detail: null, code: null, details: null },
          en,
        ),
      ).toBe(en('common.apiFailure.blocked'));
    },
  );

  it("prefers a 403's own reason — it names what you may not do", () => {
    expect(
      failureMessage(
        {
          kind: 'unauthenticated',
          status: 403,
          detail: 'You are not a referee on this pool',
          code: null,
          details: null,
        },
        en,
      ),
    ).toBe('You are not a referee on this pool');
  });

  it('ignores a 401 reason — "Unauthorized" says less than our own sentence', () => {
    expect(
      failureMessage(
        { kind: 'unauthenticated', status: 401, detail: 'Unauthorized', code: null, details: null },
        en,
      ),
    ).toBe(en('common.apiFailure.unauthenticated'));
  });

  it('keeps the three generic failures distinguishable', () => {
    // Unreachable server, dead session, and something in between refusing on
    // the server's behalf. Three different things to do about it, so three
    // different sentences.
    const network = failureMessage({ kind: 'network' }, en);
    const dead = failureMessage(
      { kind: 'unauthenticated', status: 401, detail: null, code: 'UNAUTHORIZED', details: null },
      en,
    );
    const blocked = failureMessage(
      { kind: 'unauthenticated', status: 401, detail: null, code: null, details: null },
      en,
    );
    expect(new Set([network, dead, blocked]).size).toBe(3);
  });

  it("reports the API's own reason for a failed response", () => {
    expect(
      failureMessage(
        {
          kind: 'http',
          status: 409,
          detail: 'Venue is in use',
          validationErrors: null,
          code: null,
          details: null,
        },
        en,
      ),
    ).toBe('Venue is in use');
  });

  it('falls back to the generic string when the response gave no reason', () => {
    expect(
      failureMessage(
        {
          kind: 'http',
          status: 500,
          detail: null,
          validationErrors: null,
          code: null,
          details: null,
        },
        en,
      ),
    ).toBe(en('common.error'));
  });

  it("prefers the caller's own fallback to the generic one", () => {
    expect(
      failureMessage(
        {
          kind: 'http',
          status: 500,
          detail: null,
          validationErrors: null,
          code: null,
          details: null,
        },
        en,
        'Could not save the schedule.',
      ),
    ).toBe('Could not save the schedule.');
  });

  it("never lets a fallback bury the server's reason", () => {
    expect(
      failureMessage(
        {
          kind: 'http',
          status: 409,
          detail: 'Venue is in use',
          validationErrors: null,
          code: null,
          details: null,
        },
        en,
        'Generic.',
      ),
    ).toBe('Venue is in use');
  });

  it('names every rejected field, not just the first one the API put in detail', () => {
    // `normalizeMessage` collapses a class-validator array to `rawMessage[0]`,
    // so `detail` is one of four and the other three ride under
    // `details.validationErrors`. Reading only `detail` told an organiser about
    // one bad field, they fixed it, and the form rejected them again.
    expect(
      failureMessage(
        {
          kind: 'http',
          status: 400,
          detail: 'email must be an email',
          validationErrors: [
            'email must be an email',
            'name should not be empty',
            'startsAt must be a valid ISO date',
          ],
          code: null,
          details: null,
        },
        en,
      ),
    ).toBe('email must be an email · name should not be empty · startsAt must be a valid ISO date');
  });

  it('beats the fallback with the field list, the same way a lone detail does', () => {
    expect(
      failureMessage(
        {
          kind: 'http',
          status: 400,
          detail: 'email must be an email',
          validationErrors: ['email must be an email', 'name should not be empty'],
          code: null,
          details: null,
        },
        en,
        'Could not save the event.',
      ),
    ).toBe('email must be an email · name should not be empty');
  });

  it('reads a one-entry list as the sentence it already was', () => {
    // With one entry the join IS `detail`, which is why the mapper does not
    // branch on length — the two arms could not be told apart.
    expect(
      failureMessage(
        {
          kind: 'http',
          status: 400,
          detail: 'email must be an email',
          validationErrors: ['email must be an email'],
          code: null,
          details: null,
        },
        en,
      ),
    ).toBe('email must be an email');
  });

  // Nest's stock ThrottlerException. Not a sentence — a class name with a colon
  // in it — and on a 4xx `detail` outranks the fallback, so it would have been
  // what an operator read on seven admin screens that already say better.
  const THROTTLED = 'ThrottlerException: Too many requests';

  it('answers a throttled request in the operator’s language, not the class name', () => {
    expect(
      failureMessage(
        {
          kind: 'http',
          status: 429,
          detail: THROTTLED,
          validationErrors: null,
          code: null,
          details: null,
        },
        en,
      ),
    ).toBe(en('common.apiFailure.tooManyRequests'));
  });

  it('beats the caller’s fallback, which never says to wait', () => {
    // The fallback here is what every throttled call site actually passes: the
    // sentence for the ACTION. It says nothing about waiting, so letting it win
    // would leave this branch unable to produce its own string even once.
    expect(
      failureMessage(
        {
          kind: 'http',
          status: 429,
          detail: THROTTLED,
          validationErrors: null,
          code: null,
          details: null,
        },
        en,
        'Could not disable the account.',
      ),
    ).toBe(en('common.apiFailure.tooManyRequests'));
  });

  // The API's exception filter fills `detail` on every problem+json body, so a
  // 500 always arrives carrying the scrubbed placeholder rather than nothing.
  // Before this, that placeholder beat the screen's own localised sentence and
  // `fallback` could only be reached via an edge proxy's non-JSON error page.
  const SCRUBBED = 'Internal server error';

  it("lets the screen's own sentence beat a scrubbed 5xx", () => {
    expect(
      failureMessage(
        {
          kind: 'http',
          status: 500,
          detail: SCRUBBED,
          validationErrors: null,
          code: null,
          details: null,
        },
        en,
        'Could not save the backup schedule.',
      ),
    ).toBe('Could not save the backup schedule.');
  });

  it('falls to the generic string on a scrubbed 5xx with no fallback', () => {
    expect(
      failureMessage(
        {
          kind: 'http',
          status: 500,
          detail: SCRUBBED,
          validationErrors: null,
          code: null,
          details: null,
        },
        en,
      ),
    ).toBe(en('common.error'));
  });

  it('keeps a 503 reason — the one ≥500 the filter does not scrub', () => {
    // OperationalUnavailableException: authored for the operator, always a 503.
    expect(
      failureMessage(
        {
          kind: 'http',
          status: 503,
          detail: 'A restore is in progress. Try again shortly.',
          validationErrors: null,
          code: null,
          details: null,
        },
        en,
        'Could not save the backup schedule.',
      ),
    ).toBe('A restore is in progress. Try again shortly.');
  });

  it('still reaches the fallback when a proxy answered with no reason at all', () => {
    // The case that used to be the ONLY way `fallback` was ever seen.
    expect(
      failureMessage(
        {
          kind: 'http',
          status: 502,
          detail: null,
          validationErrors: null,
          code: null,
          details: null,
        },
        en,
        'Could not load backups.',
      ),
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
