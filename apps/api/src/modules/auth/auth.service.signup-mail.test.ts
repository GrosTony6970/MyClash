/**
 * A Fighter's sign-up by email mails its own confirmation link (operator ruling 2026-10-16).
 *
 * Léa signed up with an email and a password. The page said "check your email", and no mail
 * came: the account was made by GoTrue's admin create, which never mails, and production does
 * not confirm an address on its own. She could only get in by "email me a link".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';
import { mockSupabase } from '../../common/testing/supabase-chain';

const EMAIL = 'lea@example.com';
const PASSWORD = 'A-much-Longer-passw0rd!';
const MADE = {
  data: { user: { id: 'user-lea' }, properties: { hashed_token: 'c0de' } },
  error: null,
};
const TAKEN = { data: { user: null, properties: null }, error: { message: 'already registered' } };

function build(answer: unknown) {
  const generateLink = vi.fn().mockResolvedValue(answer);
  const sendMagicLink = vi.fn();
  const recordForUser = vi.fn();
  const db = mockSupabase({ feature_flags: { rows: [] } });
  const service = new AuthService(
    { service: { from: db.service.from, auth: { admin: { generateLink } } } } as never,
    { sendMagicLink } as never,
    { get: vi.fn((key: string, def?: string) => (key === 'DOMAIN' ? 'myclash.fr' : def)) } as never,
    {} as never,
    { assertCurrent: vi.fn(() => ({})), recordForUser } as unknown as LegalAcceptanceService,
    {} as never,
  );
  const signUp = (next?: string) => service.publicSignup(` ${EMAIL} `, PASSWORD, {}, {}, next);
  return { signUp, generateLink, sendMagicLink, recordForUser };
}

const SAME_ANSWER = { message: 'If this email is new, a confirmation link has been sent.' };

afterEach(() => vi.clearAllMocks());

describe('the participant sign-up mails its confirmation link', () => {
  it('makes the account and its link in one call, and mails the link that lands where she began', async () => {
    const { signUp, generateLink, sendMagicLink, recordForUser } = build(MADE);

    expect(await signUp('/e/fal-2026/w/longsword-basics')).toEqual(SAME_ANSWER);

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
    const { signUp, sendMagicLink } = build(MADE);

    await signUp('https://evil.example/');

    expect(sendMagicLink.mock.calls[0]![0].magicLink).toBe(
      'https://api.myclash.fr/api/v1/auth/callback?type=public_login&next=%2F&token_hash=c0de',
    );
  });

  it('mails nothing for an address that has an account, and answers the same', async () => {
    const { signUp, sendMagicLink, recordForUser } = build(TAKEN);

    expect(await signUp('/me')).toEqual(SAME_ANSWER);

    expect(sendMagicLink).not.toHaveBeenCalled();
    expect(recordForUser).not.toHaveBeenCalled();
  });

  it('mails nothing when the auth server gave no code, rather than a link that cannot work', async () => {
    const { signUp, sendMagicLink } = build({ ...MADE, data: { ...MADE.data, properties: {} } });

    expect(await signUp()).toEqual(SAME_ANSWER);
    expect(sendMagicLink).not.toHaveBeenCalled();
  });
});
