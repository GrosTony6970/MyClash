/**
 * A Fighter's sign-up by email mails its own confirmation link (operator ruling 2026-10-16).
 *
 * Léa signed up with an email and a password. The page said "check your email", and no mail
 * came: the account was made by GoTrue's admin create, which never mails, and production does
 * not confirm an address on its own. She could only get in by "email me a link".
 *
 * Her first mail went to spam, and she signed up again the next day. GoTrue's signup link
 * answers that like a new account: it hands back hers with a fresh code and keeps her first
 * password. A second ruling of 2026-10-16: send the link again, say that a password chosen
 * before stays, and write no second legal acceptance on her account.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';
import { mockSupabase } from '../../common/testing/supabase-chain';

const EMAIL = 'lea@example.com';
const PASSWORD = 'A-much-Longer-passw0rd!';
const CREATED = { data: { user: { id: 'user-lea' } }, error: null };
const EXISTS = {
  data: { user: null },
  error: {
    code: 'email_exists',
    message: 'A user with this email address has already been registered',
  },
};
const LINK = {
  data: { user: { id: 'user-lea' }, properties: { hashed_token: 'c0de' } },
  error: null,
};
/** GoTrue's signup link on a CONFIRMED account. */
const CONFIRMED = {
  data: { user: null, properties: null },
  error: { message: 'already registered' },
};

function build(created: unknown, link: unknown = LINK) {
  const createUser = vi.fn().mockResolvedValue(created);
  const generateLink = vi.fn().mockResolvedValue(link);
  const sendMagicLink = vi.fn();
  const recordForUser = vi.fn();
  const db = mockSupabase({ feature_flags: { rows: [] } });
  const service = new AuthService(
    { service: { from: db.service.from, auth: { admin: { createUser, generateLink } } } } as never,
    { sendMagicLink } as never,
    { get: vi.fn((key: string, def?: string) => (key === 'DOMAIN' ? 'myclash.fr' : def)) } as never,
    {} as never,
    { assertCurrent: vi.fn(() => ({})), recordForUser } as unknown as LegalAcceptanceService,
    {} as never,
  );
  const signUp = (next?: string) => service.publicSignup(` ${EMAIL} `, PASSWORD, {}, {}, next);
  return { signUp, createUser, generateLink, sendMagicLink, recordForUser };
}

const SAME_ANSWER = { message: 'If this email is new, a confirmation link has been sent.' };

afterEach(() => vi.clearAllMocks());

describe('the participant sign-up mails its confirmation link', () => {
  it('makes the account, records her acceptance, and mails the link that lands where she began', async () => {
    const { signUp, createUser, generateLink, sendMagicLink, recordForUser } = build(CREATED);

    expect(await signUp('/e/fal-2026/w/longsword-basics')).toEqual(SAME_ANSWER);

    expect(createUser).toHaveBeenCalledWith({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: false,
    });
    expect(generateLink).toHaveBeenCalledWith({ type: 'signup', email: EMAIL, password: PASSWORD });
    expect(recordForUser).toHaveBeenCalledWith('user-lea', {}, {});
    expect(sendMagicLink).toHaveBeenCalledWith({
      to: EMAIL,
      type: 'confirm',
      // The public site's sign-in door: it spends the code, signs her in, then opens the page.
      magicLink:
        'https://api.myclash.fr/api/v1/auth/callback?type=public_login' +
        `&next=${encodeURIComponent('/e/fal-2026/w/longsword-basics')}&token_hash=c0de`,
    });
  });

  it('lands on the home page when the page it was given is not one of ours', async () => {
    const { signUp, sendMagicLink } = build(CREATED);

    await signUp('https://evil.example/');

    expect(sendMagicLink.mock.calls[0]![0].magicLink).toBe(
      'https://api.myclash.fr/api/v1/auth/callback?type=public_login&next=%2F&token_hash=c0de',
    );
  });

  it('sends the link again to an address that waits for its confirmation, with no second acceptance', async () => {
    const { signUp, sendMagicLink, recordForUser } = build(EXISTS);

    expect(await signUp('/me')).toEqual(SAME_ANSWER);

    expect(recordForUser).not.toHaveBeenCalled();
    expect(sendMagicLink).toHaveBeenCalledWith({
      to: EMAIL,
      // The words that say a password chosen before stays.
      type: 'confirmAgain',
      magicLink:
        'https://api.myclash.fr/api/v1/auth/callback?type=public_login&next=%2Fme&token_hash=c0de',
    });
  });

  it('mails nothing for an address whose account is confirmed, and answers the same', async () => {
    const { signUp, sendMagicLink, recordForUser } = build(EXISTS, CONFIRMED);

    expect(await signUp('/me')).toEqual(SAME_ANSWER);

    expect(sendMagicLink).not.toHaveBeenCalled();
    expect(recordForUser).not.toHaveBeenCalled();
  });

  it('asks for no link when the auth server refused the account for another reason', async () => {
    const refused = { data: { user: null }, error: { code: 'weak_password', message: 'weak' } };
    const { signUp, generateLink, sendMagicLink, recordForUser } = build(refused);

    expect(await signUp()).toEqual(SAME_ANSWER);

    expect(generateLink).not.toHaveBeenCalled();
    expect(sendMagicLink).not.toHaveBeenCalled();
    expect(recordForUser).not.toHaveBeenCalled();
  });

  it('records the acceptance of an account it made, and mails nothing, when the auth server gave no code', async () => {
    const { signUp, sendMagicLink, recordForUser } = build(CREATED, {
      ...LINK,
      data: { ...LINK.data, properties: {} },
    });

    expect(await signUp()).toEqual(SAME_ANSWER);
    expect(recordForUser).toHaveBeenCalledWith('user-lea', {}, {});
    expect(sendMagicLink).not.toHaveBeenCalled();
  });

  it('answers the same when the mail fails: a server error for a new address only would tell it is new', async () => {
    const { signUp, sendMagicLink } = build(CREATED);
    sendMagicLink.mockRejectedValueOnce(new Error('mail service down'));

    expect(await signUp()).toEqual(SAME_ANSWER);
  });
});
