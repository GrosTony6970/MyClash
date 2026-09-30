/**
 * The lock message held while a duty was a draft's goes out once it is published (ruling 186).
 * Claire locked the Winter Games' referee board while the Winter Secret was a draft: Marc (a Pool
 * of it) and Nina (a bout of it) were told nothing, as the send gate drops a draft's message
 * (alert-visibility.ts). Paul referees piste 2, Jo a Pool of the public Spring Cup, and Lea's
 * Winter Secret duty was never locked. Publishing the Winter Secret tells Marc and Nina; the Event
 * leaving draft tells every locked duty of the Event, and the gate decides each again.
 */
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  type TableSeed,
} from '../../../common/testing/supabase-chain';
import { NotificationEventsService } from './notification-events.service';

const WINTER_SECRET = 't-winter-secret';
const inTournament = (tournamentId: string) => ({ phases: { tournament_id: tournamentId } });
const duty = (id: string, over: Record<string, unknown>) => ({
  id,
  event_id: 'e-winter',
  status: 'confirmed',
  pools: null,
  matches: null,
  ...over,
});

function tables(): Record<string, TableSeed> {
  return {
    referee_assignments: {
      rows: [
        duty('d-marc', { pools: inTournament(WINTER_SECRET) }),
        // PostgREST may hand a to-one embed as a one-element array.
        duty('d-nina', { matches: [inTournament(WINTER_SECRET)] }),
        duty('d-paul', {}),
        duty('d-jo', { pools: inTournament('t-spring-cup') }),
        duty('d-lea', { status: 'assigned', pools: inTournament(WINTER_SECRET) }),
        duty('d-other-event', { event_id: 'e-other', pools: null }),
      ],
    },
  };
}

let db: ReturnType<typeof mockSupabase>;
let service: NotificationEventsService;
let told: MockInstance<NotificationEventsService['assignmentChanged']>;

beforeEach(() => {
  db = mockSupabase(tables());
  service = new NotificationEventsService(db as never, {} as never);
  told = vi.spyOn(service, 'assignmentChanged').mockResolvedValue(undefined);
});

const toldIds = () => told.mock.calls.map(([id]) => id);

describe('the lock messages held for a draft go out on publish (ruling 186)', () => {
  it('publishing the Winter Secret tells the duties of its Pools and bouts only', async () => {
    await service.lockedDutiesPublished('e-winter', WINTER_SECRET);
    expect(toldIds()).toEqual(['d-marc', 'd-nina']);
  });

  it('the Event leaving draft tells every locked duty of the Event, the gate deciding each', async () => {
    await service.lockedDutiesPublished('e-winter', null);
    expect(toldIds()).toEqual(['d-marc', 'd-nina', 'd-paul', 'd-jo']);
  });

  it('reads the locked duties of the Event, with the Tournament of each Pool and bout', async () => {
    await service.lockedDutiesPublished('e-winter', null);
    expect(selectsFor(db.from, 'referee_assignments')).toEqual([
      'id, pools(phases(tournament_id)), matches(phases(tournament_id))',
    ]);
    expect(filtersFor(db.from, 'referee_assignments', 'eq')).toEqual([
      ['event_id', 'e-winter'],
      ['status', 'confirmed'],
    ]);
  });

  it('fails on a failed read, telling no one', async () => {
    db = mockSupabase({ referee_assignments: { data: null, error: { message: 'boom' } } });
    service = new NotificationEventsService(db as never, {} as never);
    told = vi.spyOn(service, 'assignmentChanged').mockResolvedValue(undefined);
    const failure = await service.lockedDutiesPublished('e-winter', null).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect(String(failure)).toContain('locked duties read failed: boom');
    expect(told).not.toHaveBeenCalled();
  });
});
