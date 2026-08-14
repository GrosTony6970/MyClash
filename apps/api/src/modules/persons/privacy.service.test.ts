import { describe, it, expect, vi, beforeEach } from 'vitest';
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

  it('falls back to defaults when no row exists yet', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    const result = await service.getOrCreateForPersons(['p-1']);
    expect(result.allowBeingFollowed).toBe(true);
    expect(result.hideWorkshopsPublicly).toBe(false);
  });
});
