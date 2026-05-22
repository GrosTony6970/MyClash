import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduleGridService } from './schedule-grid.service';

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

function makeChain(result: unknown) {
  const promise = Promise.resolve(result);
  const chain = Object.assign(promise, {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
  });

  for (const key of ['select', 'eq', 'order']) {
    (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
  }

  return chain;
}

describe('ScheduleGridService', () => {
  let service: ScheduleGridService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ScheduleGridService(mockSupabase as never);
  });

  it('returns matches for the admin schedule grid', async () => {
    fromMock.mockReturnValueOnce(
      makeChain({
        data: [
          {
            id: 'match-1',
            match_number_label: 'P1-M1',
            status: 'scheduled',
            lice_id: 'lice-1',
            scheduled_at: '2026-05-21T10:00:00.000Z',
            red_registration_id: 'red-reg',
            blue_registration_id: 'blue-reg',
            red: { persons: { display_name: 'Red Fighter' } },
            blue: { persons: { display_name: 'Blue Fighter' } },
            phases: { tournaments: { name: 'Longsword Open' } },
          },
        ],
        error: null,
      }),
    );

    await expect(service.listEventSchedule('event-1')).resolves.toEqual([
      {
        id: 'match-1',
        matchNumberLabel: 'P1-M1',
        status: 'scheduled',
        liceId: 'lice-1',
        scheduledAt: '2026-05-21T10:00:00.000Z',
        redFighterName: 'Red Fighter',
        blueFighterName: 'Blue Fighter',
        redRegistrationId: 'red-reg',
        blueRegistrationId: 'blue-reg',
        tournamentName: 'Longsword Open',
        durationMinutes: 5,
      },
    ]);
  });

  it('returns an empty list for events without generated matches', async () => {
    fromMock.mockReturnValueOnce(makeChain({ data: [], error: null }));

    await expect(service.listEventSchedule('event-1')).resolves.toEqual([]);
  });
});
