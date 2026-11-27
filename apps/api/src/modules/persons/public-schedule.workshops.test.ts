import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDutyWindows, resolvePhaseSpans, resolvePoolSpans } from '../schedule/duty-windows';
import { resolvePoolBlocks } from '../schedule/pool-block-ends';
import { buildService, q, rows } from './public-schedule.fixtures';

/**
 * The Workshops a person TEACHES, on their schedule beside the ones they attend. Split from
 * `public-schedule.service.test.ts` (400-line cap). The span helpers have their own tests; this
 * person has no bout and no duty, so they only need to answer empty.
 */
vi.mock('../schedule/duty-windows', () => ({
  resolveDutyWindows: vi.fn(),
  resolvePoolSpans: vi.fn(),
  resolvePhaseSpans: vi.fn(),
}));
vi.mock('../schedule/pool-block-ends', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolvePoolBlocks: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(resolveDutyWindows).mockResolvedValue(new Map());
  vi.mocked(resolvePoolSpans).mockResolvedValue([]);
  vi.mocked(resolvePhaseSpans).mockResolvedValue([]);
  vi.mocked(resolvePoolBlocks).mockResolvedValue(new Map());
});
afterEach(() => vi.clearAllMocks());

const EVENT = 'ev-1';
const PERSON = 'p-1';

/** An instructor line of one of this Event's Workshops, with one session. */
const taught = {
  global_person_id: 'gp-1',
  workshops: {
    slug: 'demo-6',
    title: 'Demo Workshop 6',
    event_id: EVENT,
    workshop_sessions: [
      {
        id: 's-demo',
        starts_at: '2027-05-22T14:00:00Z',
        ends_at: '2027-05-22T16:00:00Z',
        location_label: 'Hall C',
        status: 'scheduled',
      },
    ],
  },
};

describe('PublicScheduleService.getSchedule — the Workshops a person teaches', () => {
  it('lists the sessions the person teaches at this Event', async () => {
    const { service, chains } = buildService(rows([]), {
      showWorkshops: true,
      instructorLines: [taught],
    });

    const schedule = await service.getSchedule(EVENT, PERSON, PERSON);

    expect(schedule.teaching).toEqual([
      {
        sessionId: 's-demo',
        workshopSlug: 'demo-6',
        workshopName: 'Demo Workshop 6',
        sessionStart: '2027-05-22T14:00:00Z',
        sessionEnd: '2027-05-22T16:00:00Z',
        location: 'Hall C',
        sessionCancelled: false,
      },
    ]);
    // Keyed on the global person, read once for the duties and the classes both.
    expect(chains.get('workshop_instructors')?.[0]?.eq).toHaveBeenCalledWith(
      'global_person_id',
      'gp-1',
    );
    expect(chains.get('persons')).toHaveLength(1);
    expect(chains.get('referee_assignments')?.[0]?.eq).toHaveBeenCalledWith('person_id', 'gp-1');
  });

  it('hides them with the rest of the Workshops of a person who hides theirs (ruling 132)', async () => {
    const { service, chains } = buildService(rows([]), {
      showWorkshops: false,
      instructorLines: [taught],
    });

    const schedule = await service.getSchedule(EVENT, PERSON, null);

    expect(schedule.teaching).toBeNull();
    expect(schedule.workshops).toBeNull();
    expect(chains.get('workshop_instructors')).toBeUndefined();
  });

  it('refuses, rather than answer "no class, no duty", when the person cannot be read', async () => {
    const { service, supabase } = buildService(rows([]), { showWorkshops: true });
    const from = supabase.service.from.getMockImplementation()!;
    supabase.service.from.mockImplementation((table: string) =>
      table === 'persons' ? q({ data: null, error: { message: 'connection lost' } }) : from(table),
    );

    await expect(service.getSchedule(EVENT, PERSON, PERSON)).rejects.toThrow(
      `The person ${PERSON} could not be read: connection lost`,
    );
  });

  it('gives a person linked to no global person no class and no duty, and asks for neither', async () => {
    const { service, chains } = buildService(rows([]), {
      showWorkshops: true,
      globalPersonId: null,
      instructorLines: [taught],
    });

    const schedule = await service.getSchedule(EVENT, PERSON, PERSON);

    expect(schedule.teaching).toEqual([]);
    expect(schedule.refereeSlots).toEqual([]);
    expect(chains.get('workshop_instructors')).toBeUndefined();
    expect(chains.get('referee_assignments')).toBeUndefined();
  });
});
