import { describe, expect, it, vi } from 'vitest';
import type { MyEvent } from '../../me/me-events.service';
import { whoami } from './whoami';

const noRoles = {
  isCompetitor: false,
  isReferee: false,
  isWorkshopParticipant: false,
  isInstructor: false,
};

const entry = (
  id: string,
  name: string,
  slug: string,
  startDate: string | null,
  roles: Partial<MyEvent['roles']>,
): MyEvent =>
  ({
    event: {
      id,
      slug,
      name,
      startDate,
      endDate: null,
      status: 'published',
      timezone: 'Europe/Paris',
      kind: 'tournament',
      photoMode: null,
    },
    roles: { ...noRoles, ...roles },
    tournaments: [{ id: 'tournament-uuid' }],
    refereeOf: [],
    workshopsTeaching: [],
    counts: { matches: 3, refereeSlots: 1, workshops: 0 },
  }) as unknown as MyEvent;

/** Every key of an object, at any depth, arrays included. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]);
  }
  return [];
}

describe('whoami', () => {
  it('maps each Event to its name, slug and role words', async () => {
    const listMyEvents = vi.fn().mockResolvedValue([
      entry('event-uuid-1', 'FAL 2026', 'fal-2026', '2026-03-14', {
        isCompetitor: true,
        isReferee: true,
      }),
      entry('event-uuid-2', 'Stage longsword', 'stage-longsword', null, {
        isInstructor: true,
        isWorkshopParticipant: true,
      }),
    ]);

    const result = await whoami({ userId: 'user-1', email: 'a@b.c', clientId: 'claude-client' }, {
      meEvents: { listMyEvents },
    } as never);

    expect(listMyEvents).toHaveBeenCalledWith({ userId: 'user-1', staff: null });
    expect(result).toEqual({
      email: 'a@b.c',
      events: [
        {
          name: 'FAL 2026',
          slug: 'fal-2026',
          startDate: '2026-03-14',
          roles: ['fighter', 'referee'],
        },
        {
          name: 'Stage longsword',
          slug: 'stage-longsword',
          startDate: null,
          roles: ['instructor', 'workshop participant'],
        },
      ],
    });
    expect(keysOf(JSON.parse(JSON.stringify(result)))).not.toContain('id');
  });
});
