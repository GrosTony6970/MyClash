/**
 * The lock message held while a duty was a draft's goes out once it is published (ruling 186).
 * Claire locked the Winter Games' referee board while the Winter Secret was a draft: Marc (a Pool
 * of it) and Nina (a bout of it) were told nothing, as the send gate drops a draft's message
 * (alert-visibility.ts). Paul referees piste 2, Jo a Pool of the public Spring Cup, and Lea's
 * Winter Secret duty was never locked. Publishing the Winter Secret tells Marc and Nina. The Event
 * going live tells Paul, Jo and Zoe (a bout of the Spring Cup): a piste duty, and the duties of a
 * Tournament that is published or running. Ava refereed a Pool of the Autumn Open, which is
 * completed, and Eve a bout of it: their duties are over, so the Event tells them nothing (ruling
 * 193). Nor Max, of the archived Old Cup. The gate decides each message again.
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
const inTournament = (tournamentId: string, status = 'draft') => ({
  phases: { tournament_id: tournamentId, tournaments: { status } },
});
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
        duty('d-jo', { pools: inTournament('t-spring-cup', 'published') }),
        // PostgREST may hand the Tournament embed as a one-element array too.
        duty('d-zoe', {
          matches: {
            phases: [{ tournament_id: 't-spring-cup', tournaments: [{ status: 'running' }] }],
          },
        }),
        duty('d-ava', { pools: inTournament('t-autumn-open', 'completed') }),
        duty('d-eve', { matches: inTournament('t-autumn-open', 'completed') }),
        duty('d-max', { pools: inTournament('t-old-cup', 'archived') }),
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

  it('the Event going live tells its piste duties and those of a live Tournament (ruling 193)', async () => {
    await service.lockedDutiesPublished('e-winter', null);
    expect(toldIds()).toEqual(['d-paul', 'd-jo', 'd-zoe']);
  });

  it('reads the locked duties of the Event, with the Tournament of each Pool and bout', async () => {
    await service.lockedDutiesPublished('e-winter', null);
    const tournament = 'phases(tournament_id, tournaments(status))';
    expect(selectsFor(db.from, 'referee_assignments')).toEqual([
      `id, pools(${tournament}), matches(${tournament})`,
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
