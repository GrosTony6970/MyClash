/**
 * What the sign-in screen says when a sign-in fails (quick wins S1 and S3).
 *
 * A volunteer types a correct PIN with no wifi. The screen said "Could not
 * sign in with this event, username, and PIN", as for a wrong PIN. They typed
 * it again, ten times, into the lock of the account.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '@myclash/api-client';
import { en, fr } from '@myclash/i18n';
import { OFFLINE_CODE } from '../offline/failure-kind';
import { magicLinkFailureKey, missingBeforeSignIn, pinLoginFailureKey } from './sign-in-failure';

/** An answer of the API: problem+json always carries a code and a detail. */
const refused = (status: 401 | 403): ApiFailure => ({
  kind: 'unauthenticated',
  status,
  detail: 'Invalid staff credentials',
  code: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
  details: null,
});
const http = (status: number, code: string | null = 'BAD_REQUEST'): ApiFailure => ({
  kind: 'http',
  status,
  detail: code === null ? null : 'Validation failed',
  code,
  details: null,
  validationErrors: null,
});
/** What the pad's service worker answers a dead network (`offlineResponse()`). */
const workerOffline = http(503, OFFLINE_CODE);
/** An answer of the edge in front of the API: no problem+json body. */
const edge: ApiFailure = {
  kind: 'unauthenticated',
  status: 403,
  detail: null,
  code: null,
  details: null,
};

describe('the PIN sign-in that failed', () => {
  it('says "wrong username or PIN" for the 401 of the API', () => {
    expect(pinLoginFailureKey(refused(401))).toBe('scoring.login.errors.wrongPin');
  });

  it('says "too many tries" for a 429: typing the PIN again makes it worse', () => {
    expect(pinLoginFailureKey(http(429, 'HTTP_429'))).toBe('scoring.login.errors.tooManyTries');
  });

  it('says "no connection" with no network, with the service worker or without it', () => {
    expect(pinLoginFailureKey({ kind: 'network' })).toBe('common.apiFailure.network');
    expect(pinLoginFailureKey(workerOffline)).toBe('common.apiFailure.network');
  });

  it('says the Event was not found for a 404: a wrong code, or an old link', () => {
    expect(pinLoginFailureKey(http(404, 'NOT_FOUND'))).toBe('scoring.login.errors.eventNotFound');
  });

  it('says the account or the Event is closed for the 403 of the API', () => {
    expect(pinLoginFailureKey(refused(403))).toBe('scoring.login.errors.closed');
  });

  it('says the connection was blocked for an answer of the edge, 401 or 403', () => {
    expect(pinLoginFailureKey(edge)).toBe('common.apiFailure.blocked');
    expect(pinLoginFailureKey({ ...edge, status: 401 })).toBe('common.apiFailure.blocked');
  });

  // The edge finds no route to the API and answers its own 404, with no body:
  // it read "this event was not found, check the event code".
  it('says the connection was blocked for a 404 or a 429 of the edge', () => {
    expect(pinLoginFailureKey(http(404, null))).toBe('common.apiFailure.blocked');
    expect(pinLoginFailureKey(http(429, null))).toBe('common.apiFailure.blocked');
  });

  it('says the server has a problem for a 5xx, and never "wrong PIN"', () => {
    expect(pinLoginFailureKey(http(500, 'INTERNAL_SERVER_ERROR'))).toBe(
      'scoring.login.errors.serverFault',
    );
    // A 503 that is not the worker's: the API, or the edge while it is down.
    expect(pinLoginFailureKey(http(503, null))).toBe('scoring.login.errors.serverFault');
  });

  it('keeps the old sentence for a 400: a username of two letters', () => {
    expect(pinLoginFailureKey(http(400))).toBe('scoring.login.localLoginError');
  });

  it('never says the sentence of a session that expired: nobody is signed in yet', () => {
    const every = [refused(401), refused(403), edge, http(400), http(404), http(429), http(500)];
    for (const failure of every) {
      expect(pinLoginFailureKey(failure)).not.toBe('common.apiFailure.unauthenticated');
    }
  });
});

describe('a sign-in with no Event chosen', () => {
  it('is stopped on the tablet: a request would spend a try of the edge', () => {
    expect(missingBeforeSignIn('')).toBe('scoring.login.errors.noEvent');
    expect(missingBeforeSignIn('  ')).toBe('scoring.login.errors.noEvent');
  });

  it('goes to the server once an Event is named', () => {
    expect(missingBeforeSignIn('fal-2026')).toBeNull();
  });
});

describe('the login link that was not sent', () => {
  it('says "no connection" with no network', () => {
    expect(magicLinkFailureKey({ kind: 'network' })).toBe('common.apiFailure.network');
    expect(magicLinkFailureKey(workerOffline)).toBe('common.apiFailure.network');
  });

  it('says "too many links, up to one hour" for a 429: ten an hour for the whole hall', () => {
    expect(magicLinkFailureKey(http(429, 'HTTP_429'))).toBe('scoring.login.errors.tooManyLinks');
  });

  it('says the connection was blocked for a 4xx of the edge', () => {
    expect(magicLinkFailureKey(http(429, null))).toBe('common.apiFailure.blocked');
  });

  it('says the address was refused for a 400', () => {
    expect(magicLinkFailureKey(http(400))).toBe('scoring.login.errors.emailRefused');
  });

  it('says the connection was blocked for an answer of the edge', () => {
    expect(magicLinkFailureKey(edge)).toBe('common.apiFailure.blocked');
  });

  it('says the link was not sent for anything else', () => {
    expect(magicLinkFailureKey(http(500, 'INTERNAL_SERVER_ERROR'))).toBe(
      'scoring.login.errors.linkNotSent',
    );
    expect(magicLinkFailureKey(refused(403))).toBe('scoring.login.errors.linkNotSent');
  });
});

// The functions answer keys, and the sweep of the words reads only a key
// written inside `t(...)`: a key misspelt here would print itself on screen.
describe('every sentence of a failed sign-in', () => {
  const every: ApiFailure[] = [
    { kind: 'network' },
    { kind: 'aborted' },
    workerOffline,
    edge,
    refused(401),
    refused(403),
    http(400),
    http(404, 'NOT_FOUND'),
    http(404, null),
    http(429, 'HTTP_429'),
    http(500, 'INTERNAL_SERVER_ERROR'),
  ];
  const keys = new Set([
    ...every.map(pinLoginFailureKey),
    ...every.map(magicLinkFailureKey),
    missingBeforeSignIn('') ?? '',
  ]);
  const said = (words: unknown, key: string) =>
    key.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown>)?.[part], words);

  it.each([...keys])('%s is written in English and in French', (key) => {
    expect(said(en, key)).toEqual(expect.any(String));
    expect(said(fr, key)).toEqual(expect.any(String));
    expect(said(fr, key)).not.toBe(said(en, key));
  });

  it('is one of twelve sentences', () => {
    expect(keys.size).toBe(12);
  });
});

describe('the forms of the sign-in screen', () => {
  const read = (file: string) =>
    readFileSync(join(__dirname, '..', '..', 'app', 'login', file), 'utf8');

  it('the PIN form stops before the request, then words the failure it met', () => {
    const form = read('useStaffPinLogin.ts');
    expect(form).toMatch(
      /const missing = missingBeforeSignIn\(event\.eventSlugOrCode\);\s+if \(missing\) \{\s+setError\(t\(missing\)\);\s+return;\s+\}\s+setLoading\(true\);/,
    );
    expect(form).toContain('setError(t(pinLoginFailureKey(failureFromError(err))));');
    expect(form).not.toContain("setError(t('scoring.login.localLoginError'))");
  });

  it('the email form words the failure it met, and prints no request line', () => {
    const form = read('MagicLinkForm.tsx');
    expect(form).toContain('setError(t(magicLinkFailureKey(failureFromError(err))));');
    expect(form).not.toContain('err.message');
    expect(form).not.toContain('Something went wrong');
  });
});
