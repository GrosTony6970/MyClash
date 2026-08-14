import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { PrivacyController } from './privacy.controller';

/**
 * The defect these lock down: `persons` is EVENT-SCOPED and has no unique index
 * on `claimed_by_user_id` (only `global_persons` does, 0063). The resolver used
 * `.maybeSingle()` on it, so PostgREST answered a multi-row match with PGRST116
 * and a null row -- and the error was never destructured, so the null fell
 * through to "No person profile linked to this account". Anyone entered in two
 * or more events was permanently locked out of their own privacy settings by a
 * 401 that was not true, and nothing logged why.
 */

function makeChain(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(),
    eq: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    in: vi.fn(),
    upsert: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  for (const key of ['select', 'eq', 'or', 'order', 'in', 'upsert']) {
    chain[key]?.mockReturnValue(chain);
  }
  (chain as unknown as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return chain;
}

const USER = { id: 'user-1' };

function makeController(opts: {
  globalPerson?: { data: unknown; error: unknown };
  persons?: { data: unknown; error: unknown };
  privacy?: unknown;
}) {
  const fromMock = vi.fn();
  const globalChain = makeChain(opts.globalPerson ?? { data: { id: 'gp-1' }, error: null });
  const personsChain = makeChain(opts.persons ?? { data: [], error: null });

  fromMock.mockImplementation((table: string) => {
    if (table === 'global_persons') return globalChain;
    if (table === 'persons') return personsChain;
    return makeChain({ data: null, error: null });
  });

  const supabase = {
    service: { from: fromMock },
    anon: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: USER }, error: null }) } },
  };
  const privacy = {
    getOrCreateForPersons: vi.fn().mockResolvedValue(opts.privacy ?? {}),
    updateForPersons: vi.fn().mockResolvedValue(opts.privacy ?? {}),
  };
  const controller = new PrivacyController(privacy as never, supabase as never);
  return { controller, privacy, personsChain, globalChain };
}

const REQ = { cookies: { 'sb-access-token': 'token' } } as never;

describe('PrivacyController identity resolution', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reaches the settings for a user entered in TWO events', async () => {
    // The regression. Two rows made maybeSingle return null-with-PGRST116, and
    // the handler read that as "no profile" and threw 401.
    const { controller, privacy } = makeController({
      persons: { data: [{ id: 'p-1' }, { id: 'p-2' }], error: null },
    });

    await expect(controller.getPrivacy(REQ)).resolves.toBeDefined();
    expect(privacy.getOrCreateForPersons).toHaveBeenCalledWith(['p-1', 'p-2']);
  });

  it('still works for a user with exactly one event', async () => {
    const { controller, privacy } = makeController({
      persons: { data: [{ id: 'p-1' }], error: null },
    });
    await controller.getPrivacy(REQ);
    expect(privacy.getOrCreateForPersons).toHaveBeenCalledWith(['p-1']);
  });

  it('resolves identity through global_persons, which IS unique on the user', async () => {
    const { controller, globalChain } = makeController({
      persons: { data: [{ id: 'p-1' }], error: null },
    });
    await controller.getPrivacy(REQ);
    expect(globalChain['eq']).toHaveBeenCalledWith('claimed_by_user_id', 'user-1');
  });

  it('writes the answer to EVERY event row, not one of them', async () => {
    // Anything less leaves the copies disagreeing, which is the state that made
    // the setting look applied while doing nothing on the other events.
    const { controller, privacy } = makeController({
      persons: { data: [{ id: 'p-1' }, { id: 'p-2' }, { id: 'p-3' }], error: null },
    });

    await controller.updatePrivacy(REQ, { hideWorkshopsPublicly: true } as never);
    expect(privacy.updateForPersons).toHaveBeenCalledWith(
      ['p-1', 'p-2', 'p-3'],
      expect.objectContaining({ hideWorkshopsPublicly: true }),
    );
  });

  it('dedupes ids the two matching clauses both returned', async () => {
    const { controller, privacy } = makeController({
      persons: { data: [{ id: 'p-1' }, { id: 'p-1' }, { id: 'p-2' }], error: null },
    });
    await controller.getPrivacy(REQ);
    expect(privacy.getOrCreateForPersons).toHaveBeenCalledWith(['p-1', 'p-2']);
  });

  it('surfaces a query failure as a 500, never as "you have no profile"', async () => {
    // Swallowing the error is what kept the original defect invisible.
    const { controller } = makeController({
      persons: { data: null, error: { message: 'boom' } },
    });
    await expect(controller.getPrivacy(REQ)).rejects.toThrow(InternalServerErrorException);
  });

  it('still 401s a user who genuinely owns no person row', async () => {
    const { controller } = makeController({ persons: { data: [], error: null } });
    await expect(controller.getPrivacy(REQ)).rejects.toThrow(UnauthorizedException);
  });

  it('401s with no session cookie', async () => {
    const { controller } = makeController({});
    await expect(controller.getPrivacy({ cookies: {} } as never)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
