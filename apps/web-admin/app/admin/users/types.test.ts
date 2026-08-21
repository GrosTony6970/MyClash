import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '@myclash/api-client';

import { readError } from './types';

/**
 * `readError` is the accounts console's one refusal sentence.
 *
 * The real translator is not reachable from here — `@myclash/i18n/admin` is a
 * built dictionary and this file is about the composition, not the catalogue —
 * so `t` echoes the key. A fallback is passed as an already-translated string
 * anyway, which is what the call sites do.
 */
const t = (key: string) => `[${key}]`;

function httpFailure(over: Partial<Extract<ApiFailure, { kind: 'http' }>> = {}): ApiFailure {
  return {
    kind: 'http',
    status: 400,
    detail: null,
    code: null,
    details: null,
    validationErrors: null,
    ...over,
  };
}

describe('readError', () => {
  it("prefers the server's own reason to the screen's fallback", () => {
    expect(
      readError(
        httpFailure({ detail: 'That account owns the only super-admin role.' }),
        t,
        'Nope.',
      ),
    ).toBe('That account owns the only super-admin role.');
  });

  it('names what is blocking a delete, which the reason alone never does', () => {
    // The API throws `BadRequestException({ message, blockers })` and the
    // exception filter moves `blockers` into the extension bag. Reading it at
    // the top level is why safe delete once said "still has references" and
    // never said to what.
    expect(
      readError(
        httpFailure({
          status: 400,
          detail: 'This account still has references.',
          details: { blockers: { persons: 1, organization_members: 2 } },
        }),
        t,
        'Nope.',
        'Blocked by',
      ),
    ).toBe('This account still has references. Blocked by: persons: 1, organization_members: 2');
  });

  it('leaves the blockers off when the caller did not ask for them', () => {
    expect(
      readError(
        httpFailure({ detail: 'Still referenced.', details: { blockers: { persons: 1 } } }),
        t,
        'Nope.',
      ),
    ).toBe('Still referenced.');
  });

  it('skips a blocker count of zero rather than printing it', () => {
    expect(
      readError(
        httpFailure({ detail: 'Still referenced.', details: { blockers: { persons: 0 } } }),
        t,
        'Nope.',
        'Blocked by',
      ),
    ).toBe('Still referenced.');
  });

  it('answers a throttle in the operator’s language, beating the action sentence', () => {
    // The seam owns this now, and it has to beat the fallback: every call site
    // passes the sentence for the ACTION, which says nothing about waiting.
    expect(
      readError(
        httpFailure({ status: 429, detail: 'ThrottlerException: Too many requests' }),
        t,
        'Could not disable the account.',
      ),
    ).toBe('[common.apiFailure.tooManyRequests]');
  });

  it('does not double the full stop the API already wrote', () => {
    expect(
      readError(
        httpFailure({ detail: 'Still referenced.', details: { blockers: { persons: 1 } } }),
        t,
        'Nope.',
        'Blocked by',
      ),
    ).toBe('Still referenced. Blocked by: persons: 1');
  });

  it('falls to the screen’s own sentence when the API gave no reason', () => {
    expect(readError(httpFailure(), t, 'Could not disable the account.')).toBe(
      'Could not disable the account.',
    );
  });

  it('has nothing to say about an aborted request', () => {
    // Null, not the fallback: the operator navigated away, and a toast about
    // their own navigation is noise. Every call site guards on this.
    expect(readError({ kind: 'aborted' }, t, 'Nope.', 'Blocked by')).toBeNull();
  });
});
