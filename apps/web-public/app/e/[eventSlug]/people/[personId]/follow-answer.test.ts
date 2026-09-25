import { describe, expect, it } from 'vitest';
import type { ApiResult } from '@myclash/api-client';
import { followRefusal } from './follow-answer';

/**
 * A Follow tap flips the button only when the server says yes (operator ruling 121b). The page
 * used to flip it whatever came back, and a signed-out tap never reached the server at all.
 */
const refused = (status: 401 | 403, code: string | null): ApiResult<unknown> => ({
  ok: false,
  kind: 'unauthenticated',
  status,
  detail: null,
  code,
  details: null,
});

describe('followRefusal', () => {
  it('a success is no refusal', () => {
    expect(followRefusal({ ok: true, data: undefined })).toBeNull();
  });

  it('signed out: the viewer is asked to sign in', () => {
    expect(followRefusal(refused(401, 'UNAUTHORIZED'))).toBe('publicApp.following.signInToFollow');
  });

  it('a person who prefers not to be followed says so', () => {
    expect(followRefusal(refused(403, 'prefers_not_followed'))).toBe(
      'publicApp.following.prefersNotFollowed',
    );
  });

  it('another 403 (an archived Event refuses every follow write) does not blame the person', () => {
    expect(followRefusal(refused(403, 'FORBIDDEN'))).toBe('publicApp.following.followUpdateError');
  });

  it.each<ApiResult<unknown>>([
    {
      ok: false,
      kind: 'http',
      status: 500,
      detail: null,
      code: null,
      details: null,
      validationErrors: null,
    },
    { ok: false, kind: 'network' },
    { ok: false, kind: 'aborted' },
  ])('anything else failed: %o', (result) => {
    expect(followRefusal(result)).toBe('publicApp.following.followUpdateError');
  });
});
