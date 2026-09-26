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

/** The columns 0208 and 0209 dropped: nothing may write one again. */
const DROPPED = [
  'enforce_dedicated_referee_rest',
  'enable_officiate_vs_fight_rule',
  'enable_double_booked_rule',
  'enable_availability_rule',
  'enforce_fighter_referee_no_overlap',
];

describe('SettingsService', () => {
  let service: SettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SettingsService(mockSupabase as never);
  });

  it("creates the Event's one row with every persisted settings column", async () => {
    const insertChain = makeChain({
      data: {
        id: 'settings-1',
        event_id: 'event-1',
        tournament_id: null,
        enforce_school_separation: true,
        school_separation_strictness: 'soft',
        enforce_skill_balance: true,
        enforce_referee_no_back_to_back: true,
        referee_rest_min_slots: 1,
        max_bouts_per_day: 0,
        workshop_conflict_warning: true,
        rating_based_ordering: true,
        workload_balance: true,
      },
      error: null,
    });
    fromMock.mockReturnValueOnce(insertChain);

    await service.createDefaults('event-1');

    const inserted = insertChain.insert.mock.calls[0]![0] as Record<string, unknown>;
    // ADR-019: no cap until an organiser sets one. One row per Event (ruling 142).
    expect(inserted['max_bouts_per_day']).toBe(0);
    expect(inserted['tournament_id']).toBeNull();
    for (const column of DROPPED) expect(inserted).not.toHaveProperty(column);
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        workshop_conflict_warning: true,
        rating_based_ordering: true,
        workload_balance: true,
      }),
    );
  });

  it("updates the Event's row with what the patch names, and nothing dropped", async () => {
    const getChain = makeChain({ data: null, error: null });
    getChain.maybeSingle.mockResolvedValue({
      data: { id: 'settings-1', event_id: 'event-1', tournament_id: null },
      error: null,
    });
    const updateChain = makeChain({
      data: { id: 'settings-1', event_id: 'event-1', tournament_id: null },
      error: null,
    });

    fromMock.mockReturnValueOnce(getChain).mockReturnValueOnce(updateChain);

    await service.upsertSettings('event-1', {
      workshopConflictWarning: false,
      ratingBasedOrdering: false,
      workloadBalance: false,
      maxBoutsPerDay: 8,
    });

    // The Event's row, never a Tournament's.
    expect(getChain.is).toHaveBeenCalledWith('tournament_id', null);
    expect(updateChain.update).toHaveBeenCalledWith({
      max_bouts_per_day: 8,
      workshop_conflict_warning: false,
      rating_based_ordering: false,
      workload_balance: false,
    });
  });

  it("answers an empty patch with the Event's row, and writes nothing", async () => {
    // Until 0209 every write carried the pinned hard-rule column; an UPDATE with no column
    // returns no row, and `.single()` turned `PUT {}` into a 400.
    const getChain = makeChain({
      data: { id: 'settings-1', event_id: 'event-1', tournament_id: null, max_bouts_per_day: 4 },
      error: null,
    });
    fromMock.mockReturnValueOnce(getChain);

    const result = await service.upsertSettings('event-1', {});

    expect(result).toMatchObject({ id: 'settings-1', maxBoutsPerDay: 4 });
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(getChain.update).not.toHaveBeenCalled();
  });
});
