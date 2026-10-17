/**
 * A Fighter's sign-up by email mails its own confirmation link (operator ruling 2026-10-16), and
 * stores no password (ruling "Pre-takeover", 2026-10-16).
 *
 * Léa signed up with an email and a password. The page said "check your email", and no mail
 * came: the account was made by GoTrue's admin create, which never mails, and production does
 * not confirm an address on its own. She could only get in by "email me a link".
 *
 * Then a stranger signed up with Léa's address and his own password. Léa never saw the mail.
 * Weeks later she confirmed her address, and the stranger's password still opened her account:
 * the auth server kept it from the first sign-up. Now a sign-up asks for the address only, and
 * the mailed link opens "choose your password".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validatePassword } from '@myclash/types';
import type { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { PublicSignupDto } from './dto/public-auth.dto';

const EMAIL = 'lea@example.com';
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
  const signUp = (next?: string) => service.publicSignup(` ${EMAIL} `, {}, {}, next);
  return { signUp, createUser, generateLink, sendMagicLink, recordForUser };
}

/** The password `generateLink('signup')` was handed. */
function linkPassword(generateLink: ReturnType<typeof vi.fn>, call = 0): string {
  return (generateLink.mock.calls[call]![0] as { password: string }).password;
}

const SAME_ANSWER = { message: 'If this email is new, a confirmation link has been sent.' };
const CHOOSE = 'https://app.myclash.fr/auth/choose-password';

afterEach(() => vi.clearAllMocks());

describe('the participant sign-up mails its confirmation link', () => {
  it('makes the account with no password, records her acceptance, and mails the choose-password page', async () => {
    const { signUp, createUser, generateLink, sendMagicLink, recordForUser } = build(CREATED);

    expect(await signUp('/e/fal-2026/w/longsword-basics')).toEqual(SAME_ANSWER);

    // No `password` key at all: the account holds nothing anyone typed.
    expect(createUser).toHaveBeenCalledWith({ email: EMAIL, email_confirm: false });
    expect(createUser.mock.calls[0]![0]).not.toHaveProperty('password');
    expect(generateLink).toHaveBeenCalledWith({
      type: 'signup',
      email: EMAIL,
      password: expect.any(String),
    });
    expect(recordForUser).toHaveBeenCalledWith('user-lea', {}, {});
    expect(sendMagicLink).toHaveBeenCalledWith({
      to: EMAIL,
      type: 'confirm',
      // The public site's page keeps the code until she sends a password, then opens the page.
      magicLink:
        `${CHOOSE}?next=${encodeURIComponent('/e/fal-2026/w/longsword-basics')}` +
        '&token_hash=c0de',
    });
  });

  it('hands generateLink a random password that meets the policy, a new one each time', async () => {
    const { signUp, generateLink } = build(CREATED);

    await signUp();
    await signUp();

    const first = linkPassword(generateLink, 0);
    expect(validatePassword(first).ok).toBe(true);
    expect(first.length).toBeGreaterThanOrEqual(40);
    expect(linkPassword(generateLink, 1)).not.toBe(first);
  });

  it('lands on the home page when the page it was given is not one of ours', async () => {
    const { signUp, sendMagicLink } = build(CREATED);

    await signUp('https://evil.example/');

    expect(sendMagicLink.mock.calls[0]![0].magicLink).toBe(`${CHOOSE}?next=%2F&token_hash=c0de`);
  });

  it('sends the same mail again to an address that waits for its confirmation, with no second acceptance', async () => {
    const { signUp, createUser, sendMagicLink, recordForUser } = build(EXISTS);

    expect(await signUp('/me')).toEqual(SAME_ANSWER);

    expect(createUser).toHaveBeenCalledWith({ email: EMAIL, email_confirm: false });
    expect(recordForUser).not.toHaveBeenCalled();
    expect(sendMagicLink).toHaveBeenCalledWith({
      to: EMAIL,
      type: 'confirm',
      magicLink: `${CHOOSE}?next=%2Fme&token_hash=c0de`,
    });
  });

  it('mails nothing for an address whose account is confirmed, and answers the same', async () => {
    const { signUp, sendMagicLink, recordForUser } = build(EXISTS, CONFIRMED);

    expect(await signUp('/me')).toEqual(SAME_ANSWER);

    expect(sendMagicLink).not.toHaveBeenCalled();
    expect(recordForUser).not.toHaveBeenCalled();
  });

  it('asks for no link when the auth server refused the account for another reason', async () => {
    const refused = { data: { user: null }, error: { code: 'unexpected_failure', message: 'x' } };
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

describe('the sign-up form sends no password', () => {
  const legal = { acceptedTerms: 'terms-1', acceptedPrivacy: 'privacy-1' };

  it('refuses a body that still carries one: an old page would store it', () => {
    const parsed = PublicSignupDto.schema.safeParse({
      email: EMAIL,
      password: 'A-much-Longer-passw0rd!',
      ...legal,
    });

    expect(parsed.success).toBe(false);
  });

  it('takes the address, the page and the legal acceptance', () => {
    expect(PublicSignupDto.schema.safeParse({ email: EMAIL, next: '/me', ...legal }).success).toBe(
      true,
    );
  });
});
