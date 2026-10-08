import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminLockdownRefusal } from '../../common/admin-lockdown';
import { captureApiException } from '../../common/observability/sentry';
import { MailedCodeRefused, MailedCodeUnjudged } from './auth-server-calls';
import { SignupController } from './signup.controller';

vi.mock('../../common/observability/sentry', () => ({ captureApiException: vi.fn() }));
const reported = vi.mocked(captureApiException);
const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

/**
 * The emailed sign-up link's landing, `GET /auth/signup-callback` (operator ruling 299).
 *
 * Anna is new. She picks "by email link" on the sign-up form and clicks the link in her mail.
 * The door signed her in, then looked for her login in the cookies her browser SENT: a new
 * person sent none, so her club was never made. A browser that still held Bob's login got the
 * club made for Bob. The club is now made for the account the LINK proved, with no `/me` read,
 * and a club that cannot be made is never answered as done (ruling 363, below).
 */
const ANNA = { id: 'user-anna', email: 'anna@example.com' };
const BOB = { id: 'user-bob', email: 'bob@example.com' };

const auth = {
  signInFromSignupLink: vi.fn(),
  getMe: vi.fn(),
  isAdminLockdownEnabled: vi.fn(async () => false),
};
const onboarding = { completeSignupAfterMagicLink: vi.fn(), assertSignupsOpen: vi.fn() };
const legal = { recordForUser: vi.fn() };

const controller = new SignupController(onboarding as never, auth as never, legal as never);

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
});

/**
 * Léa clicks her sign-up mail and the door makes no club. A browser that followed a link
 * showed the door's refusal as raw text on the API's address. The door sends her to the
 * sign-up page now, with the reason in the address (operator rulings 360, 362, 363).
 */
describe('the sign-up link that makes no club sends her to the sign-up page', () => {
  it.each<[string, Error, string]>([
    ['the auth server refuses the code', new MailedCodeRefused(), 'link_expired'],
    ['the auth server does not judge the code', new MailedCodeUnjudged('x'), 'link_unchecked'],
    ['the lockdown is switched on at the click', adminLockdownRefusal(), 'admin_lockdown'],
  ])('when %s: no club, and the reason', async (_w, refusal, reason) => {
    auth.signInFromSignupLink.mockRejectedValue(refusal);
    const reply = makeReply();

    await land(reply);

    expect(reply.redirect.mock.calls).toEqual([[`/signup?refused=${reason}`]]);
    expect(onboarding.completeSignupAfterMagicLink).not.toHaveBeenCalled();
    expect(legal.recordForUser).not.toHaveBeenCalled();
  });

  it('still fails on a fault that is no refusal of the link', async () => {
    auth.signInFromSignupLink.mockRejectedValue(new Error('the reply is closed'));
    const reply = makeReply();

    await expect(land(reply)).rejects.toThrow('the reply is closed');
    expect(reply.redirect).not.toHaveBeenCalled();
    expect(onboarding.completeSignupAfterMagicLink).not.toHaveBeenCalled();
  });

  // Ruling 363. The link is spent and she is signed in: the page says to fill the form again.
  it('says so when the club cannot be written, and reports the fault', async () => {
    const fault = new Error('Failed to create organization: connection refused');
    onboarding.completeSignupAfterMagicLink.mockRejectedValue(fault);
    const reply = makeReply();

    await land(reply);

    expect(reply.redirect.mock.calls).toEqual([['/signup?refused=club_not_made']]);
    expect(reported.mock.calls).toEqual([[fault, { door: 'auth/signup-callback' }]]);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining(ANNA.id), expect.anything());
    // What she accepted is recorded with her club, at the second click.
    expect(legal.recordForUser).not.toHaveBeenCalled();
  });
});
