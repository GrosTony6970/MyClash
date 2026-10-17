import { Logger, UnauthorizedException, type HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_LOCKDOWN_CODE,
  LINK_EXPIRED_CODE,
  LINK_UNCHECKED_CODE,
  READ_ONLY_MODE_CODE,
  SIGNUPS_DISABLED_CODE,
} from '@myclash/types';
import { adminLockdownRefusal } from '../../common/admin-lockdown';
import { captureApiException } from '../../common/observability/sentry';
import { OperationalUnavailableException } from '../../common/operational-exception';
import { SignupChoosePasswordDto, SignupDto } from '../organizations/dto/signup.dto';
import { MailedCodeRefused, MailedCodeUnjudged } from './auth-server-calls';
import { SignupController } from './signup.controller';

vi.mock('../../common/observability/sentry', () => ({ captureApiException: vi.fn() }));
const reported = vi.mocked(captureApiException);
const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

/**
 * The organiser's "choose your password" door, `POST /auth/signup-choose-password` (ruling
 * "Pre-takeover"). It carries the rulings of the old mailed sign-up link's door.
 *
 * Anna signs up as an organiser. The mail opens the page where she chooses her password. The
 * club is made for the account the CODE names, never the one her browser was signed in as
 * (ruling 299); the switches are read before the code is spent (rulings 305, 324, 341); a club
 * that cannot be made is said, never answered as done (ruling 363).
 */
const ANNA = { id: 'user-anna', email: 'anna@example.com' };
const OFF = new OperationalUnavailableException({ code: SIGNUPS_DISABLED_CODE, message: 'off' });
const READ_ONLY = new OperationalUnavailableException({ code: READ_ONLY_MODE_CODE, message: 'x' });

const auth = { choosePasswordFromCode: vi.fn(), isAdminLockdownEnabled: vi.fn() };
const onboarding = {
  assertSignupsOpen: vi.fn(),
  signup: vi.fn(),
  completeSignupAfterMagicLink: vi.fn(),
};
const legal = { recordForUser: vi.fn() };
const controller = new SignupController(onboarding as never, auth as never, legal as never);

const BODY = {
  token_hash: 'token-hash-0001',
  password: 'A-much-Longer-passw0rd!',
  orgName: 'Lyon AMHE',
  orgSlug: 'lyon-amhe',
  acceptedTerms: 'v1',
  acceptedPrivacy: 'v2',
};
const makeReply = () => ({ send: vi.fn(), setCookie: vi.fn() });
const choose = (reply = makeReply()) =>
  controller.signupChoosePassword(BODY, { headers: {} } as never, reply as never).then(() => reply);

beforeEach(() => {
  vi.clearAllMocks();
  onboarding.assertSignupsOpen.mockResolvedValue(undefined);
  onboarding.completeSignupAfterMagicLink.mockResolvedValue({ slug: 'lyon-amhe', made: true });
  auth.isAdminLockdownEnabled.mockResolvedValue(false);
  auth.choosePasswordFromCode.mockResolvedValue({ user: ANNA, saved: true, signedIn: true });
  legal.recordForUser.mockResolvedValue(undefined);
});

describe('the club is made for the account the code proved (ruling 299)', () => {
  it('spends the code with the lockdown check, makes her club and opens it', async () => {
    const reply = await choose();

    expect(auth.choosePasswordFromCode.mock.calls).toEqual([
      ['token-hash-0001', 'A-much-Longer-passw0rd!', reply, { lockdown: true }],
    ]);
    expect(onboarding.completeSignupAfterMagicLink.mock.calls).toEqual([
      [ANNA.id, 'Lyon AMHE', 'lyon-amhe'],
    ]);
    expect(legal.recordForUser.mock.calls).toEqual([
      [ANNA.id, { terms: 'v1', privacy: 'v2' }, expect.anything()],
    ]);
    expect(reply.send.mock.calls).toEqual([
      [{ saved: true, signedIn: true, next: '/org/lyon-amhe' }],
    ]);
  });

  // Ruling 304: Bob took `lyon-amhe` between her request and her click.
  it('opens the club that was made, not the address she asked for', async () => {
    onboarding.completeSignupAfterMagicLink.mockResolvedValue({
      slug: 'lyon-amhe-k3x',
      made: true,
    });

    const reply = await choose();

    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ next: '/org/lyon-amhe-k3x' }),
    );
  });

  // Ruling 369: Paul owns `lyon-escrime` and uses a second sign-up mail.
  it('opens the club an account owns already, with the reason', async () => {
    onboarding.completeSignupAfterMagicLink.mockResolvedValue({
      slug: 'lyon-escrime',
      made: false,
    });

    const reply = await choose();

    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ next: '/org/lyon-escrime?refused=already_owns_club' }),
    );
  });

  it('still makes her club when the password was not saved: she is signed in by the code', async () => {
    auth.choosePasswordFromCode.mockResolvedValue({ user: ANNA, saved: 'unknown', signedIn: true });

    const reply = await choose();

    expect(reply.send.mock.calls).toEqual([
      [{ saved: 'unknown', signedIn: true, next: '/org/lyon-amhe' }],
    ]);
  });

  // Ruling 363: the code is spent and she is signed in; the page says the club was not made.
  it('says so when the club cannot be written, and reports the fault', async () => {
    const fault = new Error('Failed to create organization: connection refused');
    onboarding.completeSignupAfterMagicLink.mockRejectedValue(fault);

    const reply = await choose();

    expect(reply.send.mock.calls).toEqual([
      [{ code: 'club_not_made', saved: true, signedIn: true }],
    ]);
    expect(reported.mock.calls).toEqual([[fault, { door: 'auth/signup-choose-password' }]]);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining(ANNA.id), expect.anything());
    expect(legal.recordForUser).not.toHaveBeenCalled();
  });
});

describe('a code that makes no club', () => {
  it('answers 401 link_expired for a code the auth server refused', async () => {
    auth.choosePasswordFromCode.mockRejectedValue(new MailedCodeRefused());

    const refusal = await choose().catch((err: unknown) => err);

    expect(refusal).toBeInstanceOf(UnauthorizedException);
    expect((refusal as HttpException).getResponse()).toMatchObject({ code: LINK_EXPIRED_CODE });
    expect(onboarding.completeSignupAfterMagicLink).not.toHaveBeenCalled();
  });

  it('answers link_unchecked for a code nobody judged', async () => {
    auth.choosePasswordFromCode.mockRejectedValue(new MailedCodeUnjudged('x'));

    const reply = await choose();

    expect(reply.send.mock.calls).toEqual([[{ code: LINK_UNCHECKED_CODE }]]);
    expect(onboarding.completeSignupAfterMagicLink).not.toHaveBeenCalled();
  });

  // Ruling 324: switched on between the check before the spend and the spend.
  it('answers the lockdown with its coded 503 when it is met after the spend', async () => {
    auth.choosePasswordFromCode.mockRejectedValue(adminLockdownRefusal());

    const refusal = await choose().catch((err: unknown) => err);

    expect((refusal as HttpException).getStatus()).toBe(503);
    expect((refusal as HttpException).getResponse()).toMatchObject({ code: ADMIN_LOCKDOWN_CODE });
    expect(onboarding.completeSignupAfterMagicLink).not.toHaveBeenCalled();
  });

  it('still fails on a fault that is no refusal of the code', async () => {
    auth.choosePasswordFromCode.mockRejectedValue(new Error('the reply is closed'));

    await expect(choose()).rejects.toThrow('the reply is closed');
    expect(onboarding.completeSignupAfterMagicLink).not.toHaveBeenCalled();
  });
});

/**
 * A super admin switches sign-ups off on Tuesday; Ann uses her Monday mail on Wednesday
 * (ruling 305). Read-only mode (ruling 341) and the lockdown (ruling 324) close the door too.
 * Each is read BEFORE the code is spent: the same mail works again once they are off.
 */
describe('the switches are read before the code is spent', () => {
  it.each<[string, () => void, unknown]>([
    ['sign-ups are off', () => onboarding.assertSignupsOpen.mockRejectedValue(OFF), OFF],
    [
      'read-only mode is on',
      () => onboarding.assertSignupsOpen.mockRejectedValue(READ_ONLY),
      READ_ONLY,
    ],
  ])('refuses with the switch’s own refusal when %s', async (_w, setUp, refusal) => {
    setUp();

    await expect(choose()).rejects.toBe(refusal);
    expect(auth.choosePasswordFromCode).not.toHaveBeenCalled();
  });

  it('refuses with the lockdown’s coded 503 while the lockdown is on', async () => {
    auth.isAdminLockdownEnabled.mockResolvedValue(true);

    const refusal = await choose().catch((err: unknown) => err);

    expect((refusal as HttpException).getResponse()).toMatchObject({ code: ADMIN_LOCKDOWN_CODE });
    expect(auth.choosePasswordFromCode).not.toHaveBeenCalled();
  });

  it('says "sign-ups off" first when both switches are on', async () => {
    auth.isAdminLockdownEnabled.mockResolvedValue(true);
    onboarding.assertSignupsOpen.mockRejectedValue(OFF);

    await expect(choose()).rejects.toBe(OFF);
  });

  it('fails on any other fault of the switch, and does not spend the code', async () => {
    onboarding.assertSignupsOpen.mockRejectedValue(new Error('boom'));

    await expect(choose()).rejects.toThrow('boom');
    expect(auth.choosePasswordFromCode).not.toHaveBeenCalled();
  });

  it('refuses the sign-up form too while sign-ups are off, and mails nothing', async () => {
    onboarding.assertSignupsOpen.mockRejectedValue(OFF);

    await expect(controller.signup({} as never)).rejects.toBe(OFF);
    expect(onboarding.signup).not.toHaveBeenCalled();
  });
});

/**
 * The club the page sends is checked as the form checks it, by the door's DTO, before the
 * controller runs (ruling 305: a link edited by hand made a club under any name).
 */
describe('what the doors take', () => {
  it.each([
    ['no address', { orgSlug: undefined }],
    ['an address with a capital and a space', { orgSlug: 'Lyon AMHE' }],
    ['an address of two characters', { orgSlug: 'ly' }],
    ['an address of 51 characters', { orgSlug: 'a'.repeat(51) }],
    ['a name of one character', { orgName: 'L' }],
    ['a name of 101 characters', { orgName: 'L'.repeat(101) }],
    ['no accepted terms', { acceptedTerms: undefined }],
    ['a field it does not know', { displayName: 'Anna' }],
  ])('refuses a choice that carries %s', (_w, patch) => {
    expect(SignupChoosePasswordDto.schema.safeParse({ ...BODY, ...patch }).success).toBe(false);
  });

  it('takes the club, the versions, the code and the password', () => {
    expect(SignupChoosePasswordDto.schema.safeParse(BODY).success).toBe(true);
  });

  it.each([
    ['a password', { password: 'A-much-Longer-passw0rd!' }],
    ['a method', { method: 'password' }],
  ])('refuses a sign-up form that still sends %s: an old page would store it', (_w, patch) => {
    const form = {
      email: 'anna@example.com',
      displayName: 'Anna',
      orgName: 'Lyon AMHE',
      orgSlug: 'lyon-amhe',
      acceptedTerms: 'v1',
      acceptedPrivacy: 'v2',
    };
    expect(SignupDto.schema.safeParse(form).success).toBe(true);
    expect(SignupDto.schema.safeParse({ ...form, ...patch }).success).toBe(false);
  });
});
