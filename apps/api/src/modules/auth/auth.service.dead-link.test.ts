import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';
import { mockSupabase as seededSupabase } from '../../common/testing/supabase-chain';

/**
 * A mailed link that signs nobody in, at `GET /auth/callback` (operator rulings 360, 362).
 *
 * Léa asks for a sign-in link at 09:00 and clicks it at 11:00, or her mail scanner opened it
 * before her. The door threw a 401, and a browser that followed a link showed it as raw text
 * on the API's address: no page, no button. The door now sends her to the sign-in page of the
 * site the link was for, with the reason in the address. A code the auth server did not judge
 * is another reason: the same link works again.
 */
const LEA = { id: 'user-lea', email: 'lea@example.com' };
// What the auth server answers for a code that is made up, used or past its life (v2.195.0).
const REFUSED = { message: 'Email link is invalid or has expired', status: 403 };
const THROTTLED = { message: 'too many requests', status: 429 };

const config = {
  getOrThrow: vi.fn(() => 'http://supabase-auth:9999'),
  get: vi.fn((key: string, def?: string) => (key === 'DOMAIN' ? 'myclash.localhost' : (def ?? ''))),
};

function build(code: () => Promise<unknown>) {
  const db = seededSupabase({ feature_flags: { rows: [] } });
  const verifyOtp = vi.fn(code);
  const supabase = { service: db.service, anon: { auth: { verifyOtp } } };
  const service = new AuthService(
    supabase as never,
    { sendMagicLink: vi.fn() } as never,
    config as never,
    {} as never,
    {} as LegalAcceptanceService,
    {} as never,
  );
  vi.spyOn(service, 'tryAutolinkGlobalPerson').mockResolvedValue(undefined);
  const warned = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const reply = { setCookie: vi.fn(), redirect: vi.fn() };
  const land = (type: string, personId?: string) =>
    service.handleCallback('token-hash', type, personId, '/somewhere', reply as never);
  return { land, reply, warned };
}

const answers = (error: object) => async () => ({ data: { user: null, session: null }, error });
const signsIn = async () => ({
  data: { user: LEA, session: { access_token: 'a', refresh_token: 'r', user: LEA } },
  error: null,
});

afterEach(() => {
  vi.restoreAllMocks();
});

// The site a link was for: the organizer app, or the participant app.
const SITES: [string, string][] = [
  ['login', 'https://admin.myclash.localhost'],
  ['public_login', 'https://app.myclash.localhost'],
  ['claim', 'https://app.myclash.localhost'],
];

describe('a mailed link whose code the auth server refuses (ruling 362)', () => {
  it.each(SITES)(
    'sends the reader of a %s link to the sign-in page of its site',
    async (type, site) => {
      const { land, reply } = build(answers(REFUSED));

      await land(type, 'person-1');

      expect(reply.redirect.mock.calls).toEqual([[`${site}/login?refused=link_expired`]]);
      expect(reply.setCookie).not.toHaveBeenCalled();
    },
  );

  it('says the same for an answer that carries no session', async () => {
    const { land, reply } = build(async () => ({
      data: { user: LEA, session: null },
      error: null,
    }));

    await land('public_login');

    expect(reply.redirect.mock.calls).toEqual([
      ['https://app.myclash.localhost/login?refused=link_expired'],
    ]);
  });
});

describe('a mailed link whose code the auth server did not judge (ruling 360)', () => {
  it.each(SITES)('sends the reader of a %s link to try again, with a trace', async (type, site) => {
    const { land, reply, warned } = build(answers(THROTTLED));

    await land(type, 'person-1');

    expect(reply.redirect.mock.calls).toEqual([[`${site}/login?refused=link_unchecked`]]);
    expect(reply.setCookie).not.toHaveBeenCalled();
    expect(warned).toHaveBeenCalledWith(expect.stringContaining('too many requests'));
  });
});

describe('a mailed link whose door fails for another reason', () => {
  // The code is spent by then: "open it again" would be untrue. The fault keeps its trace.
  it('still fails, and sends nobody to a page that says "try again"', async () => {
    const { land, reply } = build(signsIn);
    reply.setCookie.mockImplementation(() => {
      throw new Error('the reply is closed');
    });

    await expect(land('public_login')).rejects.toThrow('the reply is closed');
    expect(reply.redirect).not.toHaveBeenCalled();
  });

  it('still signs in the reader of a good link, and sends her on', async () => {
    const { land, reply } = build(signsIn);

    await land('public_login');

    expect(reply.redirect.mock.calls).toEqual([['https://app.myclash.localhost/somewhere']]);
    expect(reply.setCookie).toHaveBeenCalledTimes(2);
  });
});
