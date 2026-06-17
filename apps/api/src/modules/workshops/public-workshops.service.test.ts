/**
 * public-workshops.service.test.ts
 *
 * Pins the public visibility gate:
 *   - When events.hide_workshops_publicly is true, listPublicWorkshops
 *     returns [] and never queries the workshops table (no leak).
 *   - Otherwise it queries workshops filtered to public statuses.
 */

import { describe, expect, it, vi } from 'vitest';
import { WorkshopsService } from './workshops.service';

type Resp = { data: unknown; error: { message: string } | null };

function buildSupabase(eventRow: unknown) {
  const calls = { workshopsQueried: false, statusFilter: undefined as unknown };
  const eventsApi: Record<string, unknown> = {};
  Object.assign(eventsApi, {
    select: vi.fn(() => eventsApi),
    eq: vi.fn(() => eventsApi),
    limit: vi.fn(() => eventsApi),
    maybeSingle: vi.fn(() => Promise.resolve({ data: eventRow, error: null } as Resp)),
  });
  const workshopsApi: Record<string, unknown> = {};
  Object.assign(workshopsApi, {
    select: vi.fn(() => {
      calls.workshopsQueried = true;
      return workshopsApi;
    }),
    eq: vi.fn(() => workshopsApi),
    in: vi.fn((_col: string, vals: unknown) => {
      calls.statusFilter = vals;
      return workshopsApi;
    }),
    order: vi.fn(() => workshopsApi),
    then: undefined,
  });
  // The list query is awaited at the end of the chain (.order returns the
  // promise-like). Make the final .order resolve to a row set.
  (workshopsApi['order'] as ReturnType<typeof vi.fn>).mockReturnValue(
    Object.assign(Promise.resolve({ data: [], error: null } as Resp), {
      order: vi.fn(() => Promise.resolve({ data: [], error: null } as Resp)),
    }),
  );

  const service = {
    service: {
      from: vi.fn((table: string) => (table === 'events' ? eventsApi : workshopsApi)),
    },
  };
  return { service, calls };
}

const makeSvc = (service: unknown) =>
  new WorkshopsService(
    service as never,
    { scheduleWorkshopSessionStarting: vi.fn() } as never,
    { workshopCancelled: vi.fn() } as never,
    { assertOrgRole: vi.fn() } as never,
  );

describe('WorkshopsService — public gate', () => {
  it('returns [] and never queries workshops when the event hides them publicly', async () => {
    const { service, calls } = buildSupabase({ id: 'event-1', hide_workshops_publicly: true });
    const svc = makeSvc(service);

    const result = await svc.listPublicWorkshops('fal-2027');

    expect(result).toEqual([]);
    expect(calls.workshopsQueried).toBe(false);
  });

  it('queries workshops filtered to public statuses when not hidden', async () => {
    const { service, calls } = buildSupabase({ id: 'event-1', hide_workshops_publicly: false });
    const svc = makeSvc(service);

    await svc.listPublicWorkshops('fal-2027');

    expect(calls.workshopsQueried).toBe(true);
    expect(calls.statusFilter).toEqual(['published', 'running', 'completed']);
  });

  it('returns [] for an unknown event slug', async () => {
    const { service } = buildSupabase(null);
    const svc = makeSvc(service);

    expect(await svc.listPublicWorkshops('nope')).toEqual([]);
  });
});
