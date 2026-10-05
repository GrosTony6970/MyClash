import { describe, expect, it } from 'vitest';
import { mailedLink, signInDoor } from './mailed-link';

/**
 * The link a mail carries (operator ruling 303).
 *
 * Ann asks for a sign-in mail. The API mailed the auth server's own link. On our stack that
 * link points at `/verify` on the public site, which nothing serves. Behind it the auth server
 * would spend the code itself and hand the session over after a `#`, which no door of ours can
 * read. The API now builds the link: our door, with the code as `?token_hash=`.
 */
describe('mailedLink', () => {
  it('puts the code on a door that has no query yet', () => {
    expect(mailedLink('https://app.myclash.fr/reset-password', { hashed_token: 'c0de' })).toBe(
      'https://app.myclash.fr/reset-password?token_hash=c0de',
    );
  });

  it('adds the code after the query a door already carries, and leaves that query as it is', () => {
    const door = 'https://admin.myclash.fr/api/v1/auth/signup-callback?orgName=Lyon%20AMHE';

    expect(mailedLink(door, { hashed_token: 'c0de' })).toBe(`${door}&token_hash=c0de`);
  });

  it('never hands back the auth server’s own link', () => {
    const gotrue = {
      action_link: 'https://app.myclash.fr/verify?token=c0de&type=magiclink',
      hashed_token: 'c0de',
    };

    expect(mailedLink('https://app.myclash.fr/reset-password', gotrue)).not.toContain('/verify');
  });

  it.each([
    ['no answer', null],
    ['no answer at all', undefined],
    ['an answer with no code', {}],
    ['an empty code', { hashed_token: '' }],
  ])('is no link for %s: the sender mails nothing', (_label, properties) => {
    expect(mailedLink('https://app.myclash.fr/reset-password', properties)).toBeNull();
  });
});

describe('signInDoor', () => {
  it('is the API’s sign-in door, with the kind of sign-in and where to go next', () => {
    expect(signInDoor('myclash.fr', 'public_login', '/me')).toBe(
      'https://api.myclash.fr/api/v1/auth/callback?type=public_login&next=%2Fme',
    );
  });

  it('names the roster row of a claim', () => {
    expect(signInDoor('myclash.fr', 'claim', '/', 'row-1')).toBe(
      'https://api.myclash.fr/api/v1/auth/callback?type=claim&personId=row-1&next=%2F',
    );
  });
});
