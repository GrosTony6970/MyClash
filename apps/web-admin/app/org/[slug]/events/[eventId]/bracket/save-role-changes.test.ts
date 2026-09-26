import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { saveRoleChanges } from './save-role-changes';

/**
 * The bracket override's referee writes (ADR-016): one PUT per changed role, in order,
 * stopping at the first that did not land; only the roles the organiser confirmed carry
 * `confirm: true`. The body is pinned: the route's is strict.
 */

vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const CHANGES = [
  { role: 'arbitre_declarant', refereeId: 'gp-lea' },
  { role: 'arbitre_table', refereeId: null },
];

const AMBER = {
  ok: false,
  kind: 'http',
  status: 409,
  code: 'referee_needs_confirmation',
  detail: 'needs confirmation',
  details: {
    level: 'discouraged',
    reasons: [{ code: 'own_pool', level: 'discouraged', against: null, confirmed: false }],
  },
  validationErrors: null,
};

const puts = () => vi.mocked(apiRequest).mock.calls.map(([, path, init]) => [path, init]);

beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockResolvedValue({ ok: true, data: {} } as never);
});

describe('saveRoleChanges', () => {
  it('sends each change to the per-bout door, confirming nothing unasked', async () => {
    await expect(saveRoleChanges('m-1', CHANGES, [])).resolves.toEqual({ ok: true });
    expect(puts()).toStrictEqual([
      [
        '/api/v1/matches/m-1/referee-role-assignments',
        { method: 'PUT', body: { role: 'arbitre_declarant', refereeId: 'gp-lea' } },
      ],
      [
        '/api/v1/matches/m-1/referee-role-assignments',
        { method: 'PUT', body: { role: 'arbitre_table', refereeId: null } },
      ],
    ]);
  });

  it('confirms only the roles the organiser confirmed', async () => {
    await saveRoleChanges('m-1', CHANGES, ['arbitre_declarant']);
    expect(puts().map(([, init]) => (init as { body: unknown }).body)).toStrictEqual([
      { role: 'arbitre_declarant', refereeId: 'gp-lea', confirm: true },
      { role: 'arbitre_table', refereeId: null },
    ]);
  });

  it('stops at a refusal and names the role it was about', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce(AMBER as never);
    const outcome = await saveRoleChanges('m-1', CHANGES, []);
    expect(outcome).toMatchObject({
      ok: false,
      role: 'arbitre_declarant',
      refusal: { level: 'discouraged', reasons: [expect.objectContaining({ code: 'own_pool' })] },
    });
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('hands back any other failure as it came', async () => {
    const failure = { ok: false, kind: 'network' };
    vi.mocked(apiRequest).mockResolvedValueOnce(failure as never);
    await expect(saveRoleChanges('m-1', CHANGES, [])).resolves.toEqual({
      ok: false,
      role: 'arbitre_declarant',
      failure,
    });
  });
});
