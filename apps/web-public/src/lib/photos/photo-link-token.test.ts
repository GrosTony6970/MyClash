// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_TOKEN_ON_THE_SERVER, readPhotoLinkToken, subscribeToHash } from './photo-link-token';

afterEach(() => {
  window.location.hash = '';
});

describe('the token of the photo link', () => {
  it('is the fragment without its #', () => {
    window.location.hash = '#abc-DEF_123';
    expect(readPhotoLinkToken()).toBe('abc-DEF_123');
  });

  it('is empty when the link lost its fragment', () => {
    window.location.hash = '';
    expect(readPhotoLinkToken()).toBe('');
    window.location.hash = '#';
    expect(readPhotoLinkToken()).toBe('');
  });

  it.each(['#ab%zz', '#ab%20cd', '#tök', '#a b', '#a.b'])(
    'a fragment the API never issues (%s) is no token at all',
    (hash) => {
      window.location.hash = hash;
      expect(readPhotoLinkToken()).toBe('');
    },
  );

  it('is unknown on the server, and followed when the fragment changes', () => {
    expect(NO_TOKEN_ON_THE_SERVER()).toBeNull();
    const onChange = vi.fn();
    const stop = subscribeToHash(onChange);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    stop();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
