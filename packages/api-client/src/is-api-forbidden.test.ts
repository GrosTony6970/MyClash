import { describe, expect, it } from 'vitest';

import type { ApiFailure } from './request';

import { isApiForbidden } from './failure-message';

/**
 * A 403 the API sent refuses this caller; one an edge proxy sent (neither `detail` nor `code`)
 * says "blocked, wait", and a screen must not read it as "you may not" (ruling 101).
 */
describe('isApiForbidden', () => {
  it.each<[string, ApiFailure, boolean]>([
    [
      'the API’s 403, with its sentence',
      { kind: 'unauthenticated', status: 403, detail: 'Forbidden', code: null, details: null },
      true,
    ],
    [
      'the API’s 403, with its code',
      { kind: 'unauthenticated', status: 403, detail: null, code: 'FORBIDDEN', details: null },
      true,
    ],
    [
      'an edge’s 403',
      { kind: 'unauthenticated', status: 403, detail: null, code: null, details: null },
      false,
    ],
    [
      'the API’s 401',
      {
        kind: 'unauthenticated',
        status: 401,
        detail: 'Expired',
        code: 'UNAUTHORIZED',
        details: null,
      },
      false,
    ],
    [
      'a 5xx',
      {
        kind: 'http',
        status: 500,
        detail: null,
        validationErrors: null,
        code: null,
        details: null,
      },
      false,
    ],
    ['a network failure', { kind: 'network' }, false],
  ])('%s: %s', (_, failure, expected) => {
    expect(isApiForbidden(failure)).toBe(expected);
  });
});
