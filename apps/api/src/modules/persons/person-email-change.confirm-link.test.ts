import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mockSupabase as seededSupabase,
  queriedTables,
  scopedTo,
  selectsFor,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { captureApiException } from '../../common/observability/sentry';
import { emailChangePage } from './email-change-page';
import { PersonEmailChangeController } from './person-email-change.controller';
import { PersonEmailChangeService } from './person-email-change.service';

vi.mock('../../common/observability/sentry', () => ({ captureApiException: vi.fn() }));

/**
 * The link that confirms a new address (operator ruling 371).
 *
 * Marc changes his address in his settings and clicks the link in the mail. The link is the
 * API's own door: his browser showed `{"email":"marc@new.fr"}` on the API's address, and a
 * line of error text for a dead link. The door now sends him to the participant sign-in page
 * with what became of the link in the address, and never the address itself. The call to the
 * auth server is held to 5 seconds, as the other calls of the mailed-link doors are.
 */
const hashed = (token: string) => createHash('sha256').update(token).digest('hex');
const MARC = {
  id: 'request-marc',
  token_hash: hashed('marc-token'),
  user_id: 'user-marc',
  old_email: 'marc@old.fr',
  new_email: 'marc@new.fr',
  expires_at: '2099-01-01T00:00:00.000Z',
  confirmed_at: null,
  cancelled_at: null,
};
// Another account's request, seeded FIRST: a read that names no token would confirm it.
const BOB = { ...MARC, id: 'request-bob', token_hash: hashed('bob-token'), user_id: 'user-bob' };

const requests = (marc: object): Record<string, TableSeed> => ({
  person_email_change_requests: { rows: [BOB, { ...MARC, ...marc }] },
  persons: { rows: [] },
  audit_log: { data: null, error: null },
});

function build(tables: Record<string, TableSeed> = requests({})) {
  const db = seededSupabase(tables);
  const updateUserById = vi.fn().mockResolvedValue({ data: { user: {} }, error: null });
  const supabase = { service: { from: db.service.from, auth: { admin: { updateUserById } } } };
  const config = {
    get: vi.fn((key: string, def?: string) => (key === 'DOMAIN' ? 'myclash.localhost' : def)),
  };
  const service = new PersonEmailChangeService(supabase as never, {} as never, config as never);
  const warned = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const failed = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  return { service, db, updateUserById, warned, failed };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(captureApiException).mockClear();
});

describe('a good email-change link (ruling 371)', () => {
  it('changes the address of the account its token names, and answers "changed"', async () => {
    const { service, db, updateUserById } = build();

    await expect(service.confirmEmailChange('marc-token')).resolves.toBe('changed');

    expect(updateUserById.mock.calls).toEqual([['user-marc', { email: 'marc@new.fr' }]]);
    const [confirmed] = writesTo(db, 'person_email_change_requests');
    expect(confirmed?.row).toEqual({ confirmed_at: expect.any(String) });
    expect(scopedTo(confirmed, 'id')).toBe('request-marc');
    const [moved] = writesTo(db, 'persons');
    expect(moved?.row).toMatchObject({ email: 'marc@new.fr' });
    expect(scopedTo(moved, 'claimed_by_user_id')).toBe('user-marc');
    expect(selectsFor(db.from, 'person_email_change_requests')).toEqual([
      'id, user_id, old_email, new_email, expires_at, confirmed_at, cancelled_at',
    ]);
  });
});

describe('a dead email-change link (ruling 371)', () => {
  it.each([
    ['made up', 'no-such-token', {}],
    ['already used', 'marc-token', { confirmed_at: '2026-10-09T08:00:00.000Z' }],
    ['cancelled', 'marc-token', { cancelled_at: '2026-10-09T08:00:00.000Z' }],
    ['past its hour', 'marc-token', { expires_at: '2020-01-01T00:00:00.000Z' }],
  ])('answers "dead" for a link that is %s, and changes nothing', async (_what, token, marc) => {
    const { service, db, updateUserById } = build(requests(marc));

    await expect(service.confirmEmailChange(token)).resolves.toBe('dead');

    expect(updateUserById).not.toHaveBeenCalled();
    expect(writesTo(db, 'person_email_change_requests')).toEqual([]);
    expect(writesTo(db, 'persons')).toEqual([]);
  });

  it('answers "dead" for a link with no token, and reads nothing', async () => {
    const { service, db } = build();

    await expect(service.confirmEmailChange('')).resolves.toBe('dead');

    expect(queriedTables(db.from)).toEqual([]);
  });
});

describe('an email-change link the auth server refuses (ruling 371)', () => {
  // The new address holds another account, or the account is gone: a second click fails too.
  it('answers "refused", and leaves the request unconfirmed', async () => {
    const { service, db, updateUserById, warned } = build();
    updateUserById.mockResolvedValue({
      data: { user: null },
      error: { status: 422, message: 'A user with this email address has already been registered' },
    });

    await expect(service.confirmEmailChange('marc-token')).resolves.toBe('refused');

    expect(writesTo(db, 'person_email_change_requests')).toEqual([]);
    expect(writesTo(db, 'persons')).toEqual([]);
    expect(warned).toHaveBeenCalledWith(expect.stringContaining('already been registered'));
  });
});

describe('an email-change link nobody judged (ruling 371)', () => {
  it.each([
    ['a throttle', { status: 429, message: 'too many requests' }],
    ['a server fault', { status: 503, message: 'the auth server is down' }],
    ['an answer it could not read', { message: 'Unexpected token < in JSON' }],
  ])('answers "unchecked" for %s, with a trace, and writes nothing', async (_what, error) => {
    const { service, db, updateUserById, warned } = build();
    updateUserById.mockResolvedValue({ data: { user: null }, error });

    await expect(service.confirmEmailChange('marc-token')).resolves.toBe('unchecked');

    expect(writesTo(db, 'person_email_change_requests')).toEqual([]);
    expect(warned).toHaveBeenCalledWith(expect.stringContaining(error.message));
  });

  // The auth server never answers: the limit ends the wait. The same link works again.
  it('answers "unchecked" when the five seconds run out, with a trace', async () => {
    const limits: number[] = [];
    const clocks: AbortController[] = [];
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      limits.push(ms);
      clocks.push(new AbortController());
      return clocks.at(-1)!.signal;
    });
    const { service, db, updateUserById, warned } = build();
    updateUserById.mockReturnValue(new Promise<never>(() => undefined));

    const confirmed = service.confirmEmailChange('marc-token');
    await vi.waitFor(() => expect(updateUserById).toHaveBeenCalled());
    clocks.at(-1)!.abort();

    await expect(confirmed).resolves.toBe('unchecked');
    expect(limits).toEqual([5000]);
    expect(writesTo(db, 'person_email_change_requests')).toEqual([]);
    expect(warned).toHaveBeenCalledWith(expect.stringContaining('no answer in time'));
  });

  // Nothing is written yet: "open it again" is true. The door redirects, so it reports here.
  it('answers "unchecked" when the request cannot be read, and reports the fault', async () => {
    const { service, updateUserById, failed } = build({
      ...requests({}),
      person_email_change_requests: { data: null, error: { message: 'statement timeout' } },
    });

    await expect(service.confirmEmailChange('marc-token')).resolves.toBe('unchecked');

    expect(updateUserById).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledWith(expect.stringContaining('statement timeout'));
    expect(vi.mocked(captureApiException).mock.calls).toEqual([
      [expect.any(Error), { door: 'persons/me/email-change/confirm' }],
    ]);
  });

  // supabase-js can reject after the address is changed: "open it again" is not known to be true.
  it('still fails when the call itself throws', async () => {
    const { service, updateUserById } = build();
    updateUserById.mockRejectedValue(new Error('the socket closed'));

    await expect(service.confirmEmailChange('marc-token')).rejects.toThrow('the socket closed');
  });
});

describe('the page an email-change link sends its reader to (ruling 371)', () => {
  it.each([
    ['changed', 'https://app.myclash.localhost/login?emailChange=changed'],
    ['refused', 'https://app.myclash.localhost/login?emailChange=not_changed'],
    ['dead', 'https://app.myclash.localhost/login?refused=link_expired'],
    ['unchecked', 'https://app.myclash.localhost/login?refused=link_unchecked'],
  ] as const)('is the participant sign-in page, for "%s"', (outcome, page) => {
    expect(emailChangePage('myclash.localhost', outcome)).toBe(page);
  });

  it('is where the door redirects, and the door answers no body', async () => {
    const { service } = build();
    const reply = { redirect: vi.fn(), send: vi.fn() };

    const answered = await new PersonEmailChangeController(service).confirm(
      'marc-token',
      reply as never,
    );

    expect(answered).toBeUndefined();
    expect(reply.redirect.mock.calls).toEqual([
      ['https://app.myclash.localhost/login?emailChange=changed'],
    ]);
    expect(reply.send).not.toHaveBeenCalled();
  });

  // The new address is in no address a browser keeps: not in the history, not in a log.
  it('never carries the address', async () => {
    const { service } = build();
    const reply = { redirect: vi.fn() };

    await new PersonEmailChangeController(service).confirm('marc-token', reply as never);

    expect(reply.redirect).toHaveBeenCalledOnce();
    expect(String(reply.redirect.mock.calls[0]?.[0])).not.toContain('marc');
  });
});
