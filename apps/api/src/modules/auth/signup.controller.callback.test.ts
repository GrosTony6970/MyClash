import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignupController } from './signup.controller';

/**
 * The emailed sign-up link's landing, `GET /auth/signup-callback` (operator ruling 299).
 *
 * Anna is new. She picks "by email link" on the sign-up form and clicks the link in her mail.
 * The door signed her in, then looked for her login in the cookies her browser SENT: a new
 * person sent none, so her club was never made. A browser that still held Bob's login got the
 * club made for Bob. The club is now made for the account the LINK proved, with no `/me` read,
 * and a club that cannot be made fails the request instead of redirecting as done.
 */
const ANNA = { id: 'user-anna', email: 'anna@example.com' };
const BOB = { id: 'user-bob', email: 'bob@example.com' };

const auth = {
  signInFromSignupLink: vi.fn(),
  getMe: vi.fn(),
};
const onboarding = { completeSignupAfterMagicLink: vi.fn() };
const legal = { recordForUser: vi.fn() };

const controller = new SignupController(
  onboarding as never,
  auth as never,
  {} as never,
  legal as never,
);

const request = (cookies: Record<string, string> = {}) => ({ cookies, headers: {} }) as never;
const makeReply = () => ({ redirect: vi.fn(), setCookie: vi.fn() });

const ACCEPTED: [string | undefined, string | undefined] = ['v1', 'v2'];

const land = (reply: ReturnType<typeof makeReply>, req = request(), accepted = ACCEPTED) =>
  controller.signupCallback(
    'token-hash',
    'Lyon AMHE',
    'lyon-amhe',
    'Anna',
    accepted[0],
    accepted[1],
    req,
    reply as never,
  );

beforeEach(() => {
  vi.clearAllMocks();
  auth.signInFromSignupLink.mockResolvedValue(ANNA);
  // What `/me` would say of the cookie the browser SENT: the trap of the old door.
  auth.getMe.mockResolvedValue({ type: 'claimed', user: BOB });
  onboarding.completeSignupAfterMagicLink.mockResolvedValue('lyon-amhe');
  legal.recordForUser.mockResolvedValue(undefined);
});

describe('the sign-up link makes the club for the account the link proved (ruling 299)', () => {
  it('makes the club for a new person, whose browser sent no login', async () => {
    const reply = makeReply();

    await land(reply);

    expect(auth.signInFromSignupLink).toHaveBeenCalledWith('token-hash', reply);
    expect(onboarding.completeSignupAfterMagicLink.mock.calls).toEqual([
      [ANNA.id, 'Lyon AMHE', 'lyon-amhe'],
    ]);
    expect(reply.redirect.mock.calls).toEqual([['/org/lyon-amhe']]);
  });

  // Ruling 304. Bob took `lyon-amhe` between her request and her click, so her club was made
  // under another address. The door sent her to `/org/lyon-amhe`: Bob's club.
  it('sends her to the club that was made, not to the address she asked for', async () => {
    onboarding.completeSignupAfterMagicLink.mockResolvedValue('lyon-amhe-k3x');
    const reply = makeReply();

    await land(reply);

    expect(reply.redirect.mock.calls).toEqual([['/org/lyon-amhe-k3x']]);
  });

  it('makes it for her, not for the account the browser was signed in as', async () => {
    await land(makeReply(), request({ 'sb-access-token': 'bobs-login' }));

    expect(onboarding.completeSignupAfterMagicLink.mock.calls).toEqual([
      [ANNA.id, 'Lyon AMHE', 'lyon-amhe'],
    ]);
    expect(auth.getMe).not.toHaveBeenCalled();
  });

  it('records what she accepted against her account', async () => {
    const req = request();

    await land(makeReply(), req);

    expect(legal.recordForUser.mock.calls).toEqual([
      [ANNA.id, { terms: 'v1', privacy: 'v2' }, expect.anything()],
    ]);
  });

  it('records no acceptance when the link carries no version', async () => {
    await land(makeReply(), request(), [undefined, undefined]);

    expect(legal.recordForUser).not.toHaveBeenCalled();
  });

  it('fails when the club cannot be made, and redirects nowhere', async () => {
    onboarding.completeSignupAfterMagicLink.mockRejectedValue(
      new Error('Failed to create organization: connection refused'),
    );
    const reply = makeReply();

    await expect(land(reply)).rejects.toThrow('Failed to create organization');
    expect(reply.redirect).not.toHaveBeenCalled();
  });

  it('makes no club when the link is refused', async () => {
    auth.signInFromSignupLink.mockRejectedValue(
      new UnauthorizedException('Invalid or expired magic link'),
    );
    const reply = makeReply();

    await expect(land(reply)).rejects.toThrow(UnauthorizedException);
    expect(onboarding.completeSignupAfterMagicLink).not.toHaveBeenCalled();
    expect(reply.redirect).not.toHaveBeenCalled();
  });
});
