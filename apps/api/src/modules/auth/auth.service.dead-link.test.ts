import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';
import {
  filtersFor,
  mockSupabase as seededSupabase,
  queriedTables,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';

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

function build(
  code: () => Promise<unknown>,
  tables: Record<string, TableSeed> = { feature_flags: { rows: [] } },
) {
  const db = seededSupabase(tables);
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
  return { land, reply, warned, verifyOtp, db };
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

      await land(type);

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

  // No mail carries another type than the three. One edited by hand named a site
  // that has no sign-in page: it is read as the door's default, the organizer link.
  it('reads a type edited by hand as the organizer link', async () => {
    const { land, reply } = build(answers(REFUSED));

    await land('admin');

    expect(reply.redirect.mock.calls).toEqual([
      ['https://admin.myclash.localhost/login?refused=link_expired'],
    ]);
  });
});

describe('a mailed link whose code the auth server did not judge (ruling 360)', () => {
  it.each(SITES)('sends the reader of a %s link to try again, with a trace', async (type, site) => {
    const { land, reply, warned } = build(answers(THROTTLED));

    await land(type);

    expect(reply.redirect.mock.calls).toEqual([[`${site}/login?refused=link_unchecked`]]);
    expect(reply.setCookie).not.toHaveBeenCalled();
    expect(warned).toHaveBeenCalledWith(expect.stringContaining('too many requests'));
  });

  // The auth server never answers: the limit ends the wait. Nobody judged the code.
  it('sends her to try again too when the five seconds run out, with a trace', async () => {
    const limits: number[] = [];
    const clocks: AbortController[] = [];
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      limits.push(ms);
      clocks.push(new AbortController());
      return clocks.at(-1)!.signal;
    });
    const { land, reply, warned, verifyOtp } = build(() => new Promise<never>(() => undefined));

    const landed = land('login');
    await vi.waitFor(() => expect(verifyOtp).toHaveBeenCalled());
    clocks.at(-1)!.abort();
    await landed;

    expect(reply.redirect.mock.calls).toEqual([
      ['https://admin.myclash.localhost/login?refused=link_unchecked'],
    ]);
    expect(limits).toEqual([5000]);
    expect(reply.setCookie).not.toHaveBeenCalled();
    expect(warned).toHaveBeenCalledWith(expect.stringContaining('no answer in time'));
  });

  // supabase-js can reject after the code is spent: "open it again" would be untrue.
  it('still fails when the call itself throws, and sends nobody to try again', async () => {
    const { land, reply } = build(() => Promise.reject(new Error('the session store failed')));

    await expect(land('login')).rejects.toThrow('the session store failed');
    expect(reply.redirect).not.toHaveBeenCalled();
  });
});

/**
 * A dead CLAIM link (operator ruling 368).
 *
 * Léa asks for her "this is me" mail on the claim page of her Event and clicks it two days
 * late. The door sent her to the sign-in page, which knows nothing of her roster name: she
 * had to find her Event and her name again. It sends her back to her Event's claim page, her
 * name kept, where the form that mails a new link is.
 */
const ROSTER: Record<string, TableSeed> = {
  feature_flags: { rows: [] },
  persons: {
    rows: [
      { id: 'person-0', events: { slug: 'another-event' } },
      { id: 'person-1', events: { slug: 'fal 2026' } },
    ],
  },
};

describe('a claim link that signs nobody in (ruling 368)', () => {
  it.each([
    [REFUSED, 'link_expired'],
    [THROTTLED, 'link_unchecked'],
  ])('sends her to the claim page of her Event, her name kept', async (answer, reason) => {
    const { land, reply, db } = build(answers(answer), ROSTER);

    await land('claim', 'person-1');

    expect(reply.redirect.mock.calls).toEqual([
      [`https://app.myclash.localhost/e/fal%202026/claim?personId=person-1&refused=${reason}`],
    ]);
    expect(reply.setCookie).not.toHaveBeenCalled();
    expect(selectsFor(db.from, 'persons')).toEqual(['events(slug)']);
    expect(filtersFor(db.from, 'persons', 'eq')).toEqual([['id', 'person-1']]);
  });

  it('sends her to the sign-in page when the roster holds no such name', async () => {
    const { land, reply } = build(answers(REFUSED), ROSTER);

    await land('claim', 'person-9');

    expect(reply.redirect.mock.calls).toEqual([
      ['https://app.myclash.localhost/login?refused=link_expired'],
    ]);
  });

  // The read only chooses a page: a fault is no reason to show her raw text.
  it('sends her to the sign-in page, with a trace, when the roster cannot be read', async () => {
    const { land, reply, warned } = build(answers(REFUSED), {
      ...ROSTER,
      persons: { data: null, error: { message: 'statement timeout' } },
    });

    await land('claim', 'person-1');

    expect(reply.redirect.mock.calls).toEqual([
      ['https://app.myclash.localhost/login?refused=link_expired'],
    ]);
    expect(warned).toHaveBeenCalledWith(expect.stringContaining('statement timeout'));
  });

  it('asks the roster nothing for a claim link that names nobody', async () => {
    const { land, reply, db } = build(answers(REFUSED), ROSTER);

    await land('claim');

    expect(reply.redirect.mock.calls).toEqual([
      ['https://app.myclash.localhost/login?refused=link_expired'],
    ]);
    expect(queriedTables(db.from)).not.toContain('persons');
  });

  // `personId` on a sign-in link is not hers to name: only a claim link carries one.
  it('asks the roster nothing for a sign-in link, whatever its address names', async () => {
    const { land, reply, db } = build(answers(REFUSED), ROSTER);

    await land('public_login', 'person-1');

    expect(reply.redirect.mock.calls).toEqual([
      ['https://app.myclash.localhost/login?refused=link_expired'],
    ]);
    expect(queriedTables(db.from)).not.toContain('persons');
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

  it('signs in the reader of a good link whose type was edited by hand, on the organizer site', async () => {
    const { land, reply } = build(signsIn);

    await land('admin');

    expect(reply.redirect.mock.calls).toEqual([['https://admin.myclash.localhost/somewhere']]);
  });

  // The lockdown is asked of an organizer link only: an edited type passed it.
  it('refuses a good link whose type was edited by hand during the lockdown, as an organizer link', async () => {
    const { land, reply } = build(signsIn, {
      feature_flags: { rows: [{ key: 'admin_lockdown', enabled: true }] },
      platform_roles: { rows: [] },
    });

    await land('admin');

    expect(reply.redirect.mock.calls).toEqual([
      ['https://admin.myclash.localhost/login?refused=admin_lockdown'],
    ]);
    expect(reply.setCookie).not.toHaveBeenCalled();
  });
});
