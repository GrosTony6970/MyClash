import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from './settings.service';

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

function makeChain(result: unknown) {
  const chain = {
    select: vi.fn() as ReturnType<typeof vi.fn>,
    eq: vi.fn() as ReturnType<typeof vi.fn>,
    is: vi.fn() as ReturnType<typeof vi.fn>,
    insert: vi.fn() as ReturnType<typeof vi.fn>,
    update: vi.fn() as ReturnType<typeof vi.fn>,
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.is.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  return chain;
}

describe('SettingsService', () => {
  let service: SettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SettingsService(mockSupabase as never);
  });

  it('creates defaults with all persisted settings columns', async () => {
    const insertChain = makeChain({
      data: {
        id: 'settings-1',
        event_id: 'event-1',
        tournament_id: null,
        enforce_school_separation: true,
        school_separation_strictness: 'soft',
        enforce_skill_balance: true,
        enforce_fighter_referee_no_overlap: true,
        enforce_referee_no_back_to_back: true,
        referee_rest_min_slots: 1,
        enforce_dedicated_referee_rest: false,
        workshop_conflict_warning: true,
        rating_based_ordering: true,
        workload_balance: true,
      },
      error: null,
    });
    fromMock.mockReturnValueOnce(insertChain);

    await service.createDefaults('event-1', null);

    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        enforce_fighter_referee_no_overlap: true,
        workshop_conflict_warning: true,
        rating_based_ordering: true,
        workload_balance: true,
      }),
    );
  });

  it('upserts mutable settings while preserving fighter-referee overlap as a hard constraint', async () => {
    const getChain = makeChain({ data: null, error: null });
    getChain.maybeSingle.mockResolvedValue({
      data: {
        id: 'settings-1',
        event_id: 'event-1',
        tournament_id: null,
      },
      error: null,
    });
    const updateChain = makeChain({
      data: {
        id: 'settings-1',
        event_id: 'event-1',
        tournament_id: null,
        enforce_fighter_referee_no_overlap: true,
      },
      error: null,
    });

    fromMock.mockReturnValueOnce(getChain).mockReturnValueOnce(updateChain);

    await service.upsertSettings('event-1', null, {
      workshopConflictWarning: false,
      ratingBasedOrdering: false,
      workloadBalance: false,
    });

    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        enforce_fighter_referee_no_overlap: true,
        workshop_conflict_warning: false,
        rating_based_ordering: false,
        workload_balance: false,
      }),
    );
  });
});
