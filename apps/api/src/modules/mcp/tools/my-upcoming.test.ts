import { describe, expect, it, vi } from 'vitest';
import type { UpcomingItem } from '../../me/me-events.service';
import { myUpcoming } from './my-upcoming';
import { expectNoRawIds } from './no-raw-ids.test-helper';

const caller = { userId: 'user-1', email: 'a@b.c', clientId: 'c' };

const item = {
  kind: 'fight',
  eventId: '00000001-aaaa-4bbb-8ccc-000000000001',
  eventSlug: 'fal-2026',
  eventName: 'FAL 2026',
  eventTimezone: 'Europe/Paris',
  scheduledAt: '2026-03-14T09:00:00Z',
  matchId: '00000002-aaaa-4bbb-8ccc-000000000002',
  roundCode: 'LSW-P4-M01',
  tournamentName: 'Longsword',
  poolName: 'Pool 4',
  liceName: 'Lice A',
  opponentName: 'Jeanne Martin',
  isRed: true,
  role: null,
} satisfies UpcomingItem;

describe('my_upcoming', () => {
  it('maps each item to names and times, dropping the event and match ids', async () => {
    const getUpcoming = vi.fn().mockResolvedValue([item]);
    const result = await myUpcoming(caller, { meEvents: { getUpcoming } } as never, 5);

    expect(getUpcoming).toHaveBeenCalledWith({ userId: 'user-1', staff: null }, 5);
    expect(result).toEqual({
      upcoming: [
        {
          kind: 'fight',
          eventName: 'FAL 2026',
          eventSlug: 'fal-2026',
          timezone: 'Europe/Paris',
          start: '2026-03-14T09:00:00Z',
          roundCode: 'LSW-P4-M01',
          tournamentName: 'Longsword',
          poolName: 'Pool 4',
          liceName: 'Lice A',
          opponentName: 'Jeanne Martin',
          isRed: true,
          role: null,
        },
      ],
    });
    expectNoRawIds(result);
  });

  it('asks for 20 when the model names no limit', async () => {
    const getUpcoming = vi.fn().mockResolvedValue([]);
    await myUpcoming(caller, { meEvents: { getUpcoming } } as never);
    expect(getUpcoming).toHaveBeenCalledWith({ userId: 'user-1', staff: null }, 20);
  });
});
