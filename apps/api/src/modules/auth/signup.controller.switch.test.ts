import { BadRequestException } from '@nestjs/common';
import { ADMIN_LOCKDOWN_CODE, SIGNUP_REFUSED_PARAM, SIGNUPS_DISABLED_CODE } from '@myclash/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationalUnavailableException } from '../../common/operational-exception';
import { SignupController } from './signup.controller';

/**
 * "Sign-ups off" at the sign-up form and at the mailed link's door (operator ruling 305).
 *
 * A super admin switches sign-ups off on Tuesday. Ann asked for her sign-up mail on Monday and
 * clicks it on Wednesday. Only the form read the switch, so her account and her club were made.
 * The door now reads the switch BEFORE it spends her link: the same mail works again once the
 * switch is back on. It also checks the club's name and address before it spends the link: a
 * link edited by hand made a club under any name.
 */
const ANN = { id: 'user-ann', email: 'ann@example.com' };
const OFF = new OperationalUnavailableException({ code: SIGNUPS_DISABLED_CODE, message: 'off' });

const onboarding = {
  assertSignupsOpen: vi.fn(),
  signup: vi.fn(),
  completeSignupAfterMagicLink: vi.fn(),
};
const auth = { signInFromSignupLink: vi.fn(), isAdminLockdownEnabled: vi.fn() };
const legal = { recordForUser: vi.fn() };
const controller = new SignupController(onboarding as never, auth as never, legal as never);

const makeReply = () => ({ redirect: vi.fn(), setCookie: vi.fn() });
/** `club` is a pair so that a missing address stays `undefined`, as the router hands it. */
const land = (
  reply: ReturnType<typeof makeReply>,
  club: [string, string | undefined] = ['Lyon AMHE', 'lyon-amhe'],
) =>
  controller.signupCallback(
    'token-hash',
    club[0],
    club[1] as string,
    'Ann',
    'v1',
    'v2',
    { cookies: {}, headers: {} } as never,
    reply as never,
  );

beforeEach(() => {
  vi.clearAllMocks();
  onboarding.assertSignupsOpen.mockResolvedValue(undefined);
  onboarding.signup.mockResolvedValue({ type: 'magic_link' });
  onboarding.completeSignupAfterMagicLink.mockResolvedValue('lyon-amhe');
  auth.signInFromSignupLink.mockResolvedValue(ANN);
  auth.isAdminLockdownEnabled.mockResolvedValue(false);
});

describe('the sign-up form (ruling 305)', () => {
  it('is refused while sign-ups are off, and makes nothing', async () => {
    onboarding.assertSignupsOpen.mockRejectedValue(OFF);

    await expect(controller.signup({} as never, { headers: {} } as never)).rejects.toBe(OFF);
    expect(onboarding.signup).not.toHaveBeenCalled();
  });

  it('signs up while sign-ups are on', async () => {
    await controller.signup({} as never, { headers: {} } as never);

    expect(onboarding.signup).toHaveBeenCalledOnce();
  });
});

describe('the mailed sign-up link (ruling 305)', () => {
  it('sends her to the sign-up page with the reason while sign-ups are off', async () => {
    onboarding.assertSignupsOpen.mockRejectedValue(OFF);
    const reply = makeReply();

    await land(reply);

    expect(reply.redirect.mock.calls).toEqual([
      [`/signup?${SIGNUP_REFUSED_PARAM}=${SIGNUPS_DISABLED_CODE}`],
    ]);
  });

  it('does not spend her link while sign-ups are off: the same mail works later', async () => {
    onboarding.assertSignupsOpen.mockRejectedValue(OFF);

    await land(makeReply());

    expect(auth.signInFromSignupLink).not.toHaveBeenCalled();
    expect(onboarding.completeSignupAfterMagicLink).not.toHaveBeenCalled();
  });

  it('fails on any other fault of the switch, and does not spend her link', async () => {
    onboarding.assertSignupsOpen.mockRejectedValue(new Error('boom'));
    const reply = makeReply();

    await expect(land(reply)).rejects.toThrow('boom');
    expect(reply.redirect).not.toHaveBeenCalled();
    expect(auth.signInFromSignupLink).not.toHaveBeenCalled();
  });

  it.each([
    ['no address', 'Lyon AMHE', undefined],
    ['an address with a capital and a space', 'Lyon AMHE', 'Lyon AMHE'],
    ['an address of two characters', 'Lyon AMHE', 'ly'],
    ['an address of 51 characters', 'Lyon AMHE', 'a'.repeat(51)],
    ['a name of one character', 'L', 'lyon-amhe'],
    ['a name of 101 characters', 'L'.repeat(101), 'lyon-amhe'],
  ])('refuses a link that carries %s, before it spends the link', async (_label, name, slug) => {
    const reply = makeReply();

    await expect(land(reply, [name, slug])).rejects.toBeInstanceOf(BadRequestException);

    expect(auth.signInFromSignupLink).not.toHaveBeenCalled();
    expect(onboarding.completeSignupAfterMagicLink).not.toHaveBeenCalled();
    expect(reply.redirect).not.toHaveBeenCalled();
  });

  it('takes the name and the address the form takes', async () => {
    const reply = makeReply();

    await land(reply, ['Lyon AMHE', 'lyon-amhe-2']);

    expect(onboarding.completeSignupAfterMagicLink.mock.calls).toEqual([
      [ANN.id, 'Lyon AMHE', 'lyon-amhe-2'],
    ]);
  });
});

/**
 * The same link during the maintenance lockdown (operator ruling 324).
 *
 * Ann clicks her sign-up mail while the lockdown is on. The door spent her link, then refused
 * her: her browser showed a raw 503, her account existed with no club, and the link was dead.
 * Nobody who signs up is platform staff, so the door reads the lockdown BEFORE it spends the
 * link, as it reads "sign-ups off".
 */
describe('the mailed sign-up link during the maintenance lockdown (ruling 324)', () => {
  it('sends her to the sign-up page with the reason, and does not spend her link', async () => {
    auth.isAdminLockdownEnabled.mockResolvedValue(true);
    const reply = makeReply();

    await land(reply);

    expect(reply.redirect.mock.calls).toEqual([
      [`/signup?${SIGNUP_REFUSED_PARAM}=${ADMIN_LOCKDOWN_CODE}`],
    ]);
    expect(auth.signInFromSignupLink).not.toHaveBeenCalled();
    expect(onboarding.completeSignupAfterMagicLink).not.toHaveBeenCalled();
  });

  it('says "sign-ups off" first when both switches are on', async () => {
    auth.isAdminLockdownEnabled.mockResolvedValue(true);
    onboarding.assertSignupsOpen.mockRejectedValue(OFF);
    const reply = makeReply();

    await land(reply);

    expect(reply.redirect.mock.calls).toEqual([
      [`/signup?${SIGNUP_REFUSED_PARAM}=${SIGNUPS_DISABLED_CODE}`],
    ]);
  });

  it('makes her club while the lockdown is off', async () => {
    const reply = makeReply();

    await land(reply);

    expect(reply.redirect.mock.calls).toEqual([['/org/lyon-amhe']]);
  });
});
