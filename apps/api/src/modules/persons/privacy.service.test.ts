import { HttpException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { PrivacyService } from './privacy.service';

function makeChain(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    insert: vi.fn(),
    upsert: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  for (const key of ['select', 'eq', 'in', 'insert', 'upsert']) chain[key]?.mockReturnValue(chain);
  (chain as unknown as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return chain;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    person_id: 'p-1',
    hide_workshops_publicly: false,
    allow_being_followed: true,
    ...overrides,
  };
}

describe('privacy across a user with several event rows', () => {
  let fromMock: ReturnType<typeof vi.fn>;
  let service: PrivacyService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock = vi.fn();
    service = new PrivacyService({ service: { from: fromMock } } as never);
  });

  it('folds disagreeing copies to the most restrictive answer', async () => {
    // The copies routinely DID disagree: the settings page wrote one arbitrary
    // event row while every reader looked up the row for the event it was
    // rendering. Honouring the strictest is the only safe reading of that state
    // -- it can never publish something the user asked to hide.
    fromMock.mockReturnValue(
      makeChain({
        data: [
          row({ person_id: 'p-1', hide_workshops_publicly: false, allow_being_followed: true }),
          row({ person_id: 'p-2', hide_workshops_publicly: true, allow_being_followed: false }),
        ],
        error: null,
      }),
    );

    const result = await service.getOrCreateForPersons(['p-1', 'p-2']);
    expect(result.hideWorkshopsPublicly).toBe(true);
    expect(result.allowBeingFollowed).toBe(false);
  });

  it('leaves an agreeing set alone', async () => {
    fromMock.mockReturnValue(
      makeChain({ data: [row({ person_id: 'p-1' }), row({ person_id: 'p-2' })], error: null }),
    );
    const result = await service.getOrCreateForPersons(['p-1', 'p-2']);
    expect(result.hideWorkshopsPublicly).toBe(false);
    expect(result.allowBeingFollowed).toBe(true);
  });

  it('upserts one row per event, not one row total', async () => {
    const chain = makeChain({ data: [row()], error: null });
    fromMock.mockReturnValue(chain);

    await service.updateForPersons(['p-1', 'p-2', 'p-3'], { hideWorkshopsPublicly: true });

    expect(chain['upsert']).toHaveBeenCalledWith([
      { person_id: 'p-1', hide_workshops_publicly: true },
      { person_id: 'p-2', hide_workshops_publicly: true },
      { person_id: 'p-3', hide_workshops_publicly: true },
    ]);
  });

  it('creates the row with the defaults when none exists yet', async () => {
    const chain = makeChain({ data: null, error: null });
    // The stored row differs from the defaults, so the answer shows it came from the database.
    const stored = row({ hide_workshops_publicly: true });
    chain['single']?.mockResolvedValue({ data: stored, error: null });
    fromMock.mockReturnValue(chain);
    const result = await service.getOrCreateForPersons(['p-1']);
    expect(chain['insert']).toHaveBeenCalledWith({
      person_id: 'p-1',
      hide_workshops_publicly: false,
      allow_being_followed: true,
    });
    expect(result.hideWorkshopsPublicly).toBe(true);
  });
});

// Ruling 117a: a failed privacy read or write is a 5xx, never the defaults — the defaults
// allow being followed, so a guess could follow someone who opted out.
describe('privacy read or write that fails', () => {
  const FAILED = { data: null, error: { message: 'boom' } };
  const NONE = { data: null, error: null };

  async function expectFailure(run: Promise<unknown>, message: string) {
    await expect(run).rejects.toThrow(`${message} failed: boom`);
    await expect(run).rejects.not.toBeInstanceOf(HttpException);
  }

  it('a failed read is a 5xx, and nothing is created', async () => {
    const db = mockSupabase({ person_privacy: FAILED });
    await expectFailure(new PrivacyService(db as never).getOrCreate('p-1'), 'privacy read');
    expect(db.writes).toEqual([]);
  });

  it('a failed create is a 5xx, not the defaults', async () => {
    const db = mockSupabase({ person_privacy: [NONE, FAILED] });
    await expectFailure(new PrivacyService(db as never).getOrCreate('p-1'), 'privacy write');
  });

  it('a create that loses the race to another first read returns the row that won', async () => {
    const db = mockSupabase({
      person_privacy: [
        NONE,
        { data: null, error: { message: 'duplicate key', code: '23505' } },
        { data: row({ allow_being_followed: false }), error: null },
      ],
    });
    const result = await new PrivacyService(db as never).getOrCreate('p-1');
    expect(result.allowBeingFollowed).toBe(false);
  });
});
