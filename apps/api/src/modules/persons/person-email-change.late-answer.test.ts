import { afterEach, describe, expect, it, vi } from 'vitest';
import { writesTo } from '../../common/testing/supabase-chain';
import { captureApiException } from '../../common/observability/sentry';
import { build, heldAnswer, limitByHand, MARC, requests } from './person-email-change.fixtures';

vi.mock('../../common/observability/sentry', () => ({ captureApiException: vi.fn() }));

/**
 * The link that confirms a new address, after the auth server was asked (operator rulings
 * 372 and 373).
 *
 * Marc clicks the link while the auth server is slow. After 5 seconds he reads "open it
 * again". The auth server changes his address all the same, a little late: the API used to
 * drop that answer, and his roster rows kept the old address unless he clicked again.
 *
 * And Marc asks for an address ANOTHER account holds. The auth server answers a 500 for it,
 * as for a fault of its own (read on GoTrue v2.195.0, through supabase-js: status 500, no
 * code, "Error updating user"). He read "open it again" at every click, for the link's hour.
 */
const DOOR = { door: 'persons/me/email-change/confirm' };
const HELD_ADDRESS = { status: 500, message: 'Error updating user' };
const accounts = (...users: Array<{ id: string; email: string }>) => ({
  ok: true,
  status: 200,
  data: { users },
});
const writtenTables = (db: { writes: Array<{ table: string }> }) =>
  db.writes.map((write) => write.table);

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(captureApiException).mockClear();
});

describe('an address another account holds (ruling 373)', () => {
  it('answers "refused" at the first click, with a trace, and writes nothing', async () => {
    const { service, db, updateUserById, listAuthAdminUsers, warned } = build();
    updateUserById.mockResolvedValue({ data: { user: null }, error: HELD_ADDRESS });
    listAuthAdminUsers.mockResolvedValue(accounts({ id: 'user-zoe', email: 'marc@new.fr' }));

    await expect(service.confirmEmailChange('marc-token')).resolves.toBe('refused');

    expect(listAuthAdminUsers.mock.calls).toEqual([[1, 50, 'marc@new.fr']]);
    expect(db.writes).toEqual([]);
    expect(warned).toHaveBeenCalledWith(expect.stringContaining('another account holds'));
  });

  it.each([
    // The late answer of an earlier click changed it: his own account holds the address.
    ['his own account holds the address', accounts({ id: 'user-marc', email: 'marc@new.fr' })],
    ['nobody holds the address', accounts()],
    // The auth server lists every address that CONTAINS the one asked.
    ['only a look-alike holds it', accounts({ id: 'user-zoe', email: 'xmarc@new.fr' })],
    ['the auth server does not say who holds it', { ok: false, status: 0, data: null }],
  ])('answers "unchecked" for a 500 when %s', async (_what, listed) => {
    const { service, db, updateUserById, listAuthAdminUsers } = build();
    updateUserById.mockResolvedValue({ data: { user: null }, error: HELD_ADDRESS });
    listAuthAdminUsers.mockResolvedValue(listed);

    await expect(service.confirmEmailChange('marc-token')).resolves.toBe('unchecked');

    expect(db.writes).toEqual([]);
  });

  // A 500 is the one answer the auth server gives for a held address: a gateway's 503 is not.
  it.each([429, 502, 503, 504])('asks nobody who holds the address after a %i', async (status) => {
    const { service, updateUserById, listAuthAdminUsers } = build();
    updateUserById.mockResolvedValue({ data: { user: null }, error: { status, message: 'no' } });
    listAuthAdminUsers.mockResolvedValue(accounts({ id: 'user-zoe', email: 'marc@new.fr' }));

    await expect(service.confirmEmailChange('marc-token')).resolves.toBe('unchecked');

    expect(listAuthAdminUsers).not.toHaveBeenCalled();
  });
});

describe('an answer that comes after the limit (ruling 372)', () => {
  async function clickAndRunOut(seed = requests({})) {
    const limit = limitByHand();
    const built = build(seed);
    const late = heldAnswer();
    built.updateUserById.mockReturnValue(late.asked);

    const clicked = built.service.confirmEmailChange('marc-token');
    await vi.waitFor(() => expect(built.updateUserById).toHaveBeenCalled());
    limit.runOut();
    await expect(clicked).resolves.toBe('unchecked');
    expect(built.db.writes).toEqual([]);
    return { ...built, late };
  }

  it('moves his roster rows, closes the request and writes the audit line', async () => {
    const { db, late } = await clickAndRunOut();

    late.answer({ data: { user: {} }, error: null });

    await vi.waitFor(() => expect(writesTo(db, 'audit_log')).toHaveLength(1));
    expect(writtenTables(db)).toEqual(['persons', 'person_email_change_requests', 'audit_log']);
    expect(writesTo(db, 'persons')[0]?.row).toMatchObject({ email: 'marc@new.fr' });
    expect(writesTo(db, 'audit_log')[0]?.row).toMatchObject({
      action: 'person.email_change_confirmed',
      entity_id: 'user-marc',
    });
  });

  it('writes nothing when the late answer is a refusal', async () => {
    const { db, late, warned } = await clickAndRunOut();

    late.answer({ data: { user: null }, error: { status: 404, message: 'User not found' } });

    await vi.waitFor(() =>
      expect(warned).toHaveBeenCalledWith(expect.stringContaining('User not found')),
    );
    expect(db.writes).toEqual([]);
  });

  it('writes nothing when the late answer is no judgment, and leaves a trace', async () => {
    const { db, late, warned } = await clickAndRunOut();

    late.answer({
      data: { user: null },
      error: { status: 503, message: 'the auth server is down' },
    });

    await vi.waitFor(() =>
      expect(warned).toHaveBeenCalledWith(expect.stringContaining('the auth server is down')),
    );
    expect(db.writes).toEqual([]);
    expect(captureApiException).not.toHaveBeenCalled();
  });

  it('reports a fault of the work nobody waits for', async () => {
    const { db, late, failed } = await clickAndRunOut({
      ...requests({}),
      persons: { data: null, error: { message: 'duplicate key value' } },
    });

    late.answer({ data: { user: {} }, error: null });

    await vi.waitFor(() => expect(captureApiException).toHaveBeenCalled());
    expect(vi.mocked(captureApiException).mock.calls).toEqual([[expect.any(Error), DOOR]]);
    expect(failed).toHaveBeenCalledWith(expect.stringContaining('duplicate key value'));
    expect(writesTo(db, 'person_email_change_requests')).toEqual([]);
    expect(writesTo(db, 'audit_log')).toEqual([]);
  });
});

describe('the work after the address changed', () => {
  // A request closed before the rows moved read "changed" at the second click, rows unmoved.
  it('moves the roster rows BEFORE it closes the request', async () => {
    const { service, db } = build();

    await expect(service.confirmEmailChange('marc-token')).resolves.toBe('changed');

    expect(writtenTables(db)).toEqual(['persons', 'person_email_change_requests', 'audit_log']);
  });

  it('closes a request only while it is open, and asks which row it closed', async () => {
    const { service, db } = build();

    await service.confirmEmailChange('marc-token');

    const [closed] = writesTo(db, 'person_email_change_requests');
    expect(closed?.filters).toEqual([
      { method: 'eq', args: ['id', 'request-marc'] },
      { method: 'is', args: ['confirmed_at', null] },
    ]);
  });

  // A second click runs beside the late answer of the first: one of them closes the request.
  it('writes no audit line when another call closed the request first', async () => {
    const { service, db } = build({
      ...requests({}),
      person_email_change_requests: [
        { data: MARC, error: null },
        { data: [], error: null },
      ],
    });

    await expect(service.confirmEmailChange('marc-token')).resolves.toBe('changed');

    expect(writesTo(db, 'persons')).toHaveLength(1);
    expect(writesTo(db, 'audit_log')).toEqual([]);
  });

  // The account has the new address by then. A second click asks for the same address,
  // which the auth server takes (read on GoTrue v2.195.0), and does the work again.
  it.each([
    ['the roster rows did not move', { persons: { data: null, error: { message: 'no rows' } } }],
    [
      'the request was not closed',
      {
        person_email_change_requests: [
          { data: MARC, error: null },
          { data: null, error: { message: 'no close' } },
        ],
      },
    ],
  ])('answers "unchecked" and reports when %s', async (_what, seed) => {
    const { service, db, failed } = build({ ...requests({}), ...seed });

    await expect(service.confirmEmailChange('marc-token')).resolves.toBe('unchecked');

    expect(vi.mocked(captureApiException).mock.calls).toEqual([[expect.any(Error), DOOR]]);
    expect(failed).toHaveBeenCalledWith(expect.stringContaining('no '));
    expect(writesTo(db, 'audit_log')).toEqual([]);
  });

  it('leaves the request open when the roster rows did not move', async () => {
    const { service, db } = build({
      ...requests({}),
      persons: { data: null, error: { message: 'no rows' } },
    });

    await service.confirmEmailChange('marc-token');

    expect(writesTo(db, 'person_email_change_requests')).toEqual([]);
  });

  // supabase-js can reject after the address is changed. The door redirects: no raw text.
  it('answers "unchecked" and reports when the call itself throws', async () => {
    const { service, db, updateUserById } = build();
    updateUserById.mockRejectedValue(new Error('the socket closed'));

    await expect(service.confirmEmailChange('marc-token')).resolves.toBe('unchecked');

    expect(vi.mocked(captureApiException).mock.calls).toEqual([[expect.any(Error), DOOR]]);
    expect(db.writes).toEqual([]);
  });
});
