/**
 * workshop-instructors.service.test.ts
 *
 * Pins the Phase B instructor paths that were previously broken:
 *   - addInstructor resolves display_name from global_persons and writes
 *     { workshop_id, global_person_id, display_name } (display_name is
 *     NOT NULL in the schema; the old code inserted `person_id` and no name).
 *   - tagEventInstructor resolves a global_persons.id and upserts the
 *     event_instructors row.
 */

import { describe, expect, it, vi } from 'vitest';
import { WorkshopsService } from './workshops.service';

type Resp = { data: unknown; error: { message: string } | null };

/** A chainable stub for one table; records insert/upsert/delete payloads. */
function tableStub(maybeSingleData: unknown, captures: Record<string, unknown[]>, name: string) {
  const api: Record<string, unknown> = {};
  Object.assign(api, {
    select: vi.fn(() => api),
    eq: vi.fn(() => api),
    maybeSingle: vi.fn(() => Promise.resolve({ data: maybeSingleData, error: null } as Resp)),
    upsert: vi.fn((payload: unknown) => {
      (captures[`${name}.upsert`] ??= []).push(payload);
      const single = vi.fn(() => Promise.resolve({ data: { id: 'row-1' }, error: null } as Resp));
      // Supports both `.upsert(...)` (awaited directly, returns {error}) and
      // `.upsert(...).select('*').single()`.
      return Object.assign(Promise.resolve({ data: null, error: null } as Resp), {
        select: vi.fn(() => ({ single })),
      });
    }),
    delete: vi.fn(() => api),
  });
  return api;
}

function buildSupabase(tables: Record<string, unknown>, captures: Record<string, unknown[]>) {
  return {
    service: {
      service: {
        from: vi.fn((table: string) => tableStub(tables[table] ?? null, captures, table)),
      },
    },
  };
}

const makeSvc = (supabase: { service: unknown }) =>
  new WorkshopsService(
    supabase.service as never,
    { scheduleWorkshopSessionStarting: vi.fn().mockResolvedValue(undefined) } as never,
    { workshopCancelled: vi.fn().mockResolvedValue(undefined) } as never,
    { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
    { hiddenWorkshopGlobalPersonIds: vi.fn().mockResolvedValue(new Set<string>()) } as never,
  );

describe('WorkshopsService — instructors', () => {
  it('addInstructor writes global_person_id + a resolved display_name', async () => {
    const captures: Record<string, unknown[]> = {};
    const supabase = buildSupabase(
      {
        workshops: { event_id: 'event-1' },
        events: { organization_id: 'org-1' },
        global_persons: { display_name: 'Fiore dei Liberi' },
      },
      captures,
    );
    const svc = makeSvc(supabase);

    await svc.addInstructor('w-1', 'gp-1', 'user-1');

    expect(captures['workshop_instructors.upsert']?.[0]).toMatchObject({
      workshop_id: 'w-1',
      global_person_id: 'gp-1',
      display_name: 'Fiore dei Liberi',
    });
  });

  it('addInstructor falls back to given+family name when display_name is blank', async () => {
    const captures: Record<string, unknown[]> = {};
    const supabase = buildSupabase(
      {
        workshops: { event_id: 'event-1' },
        events: { organization_id: 'org-1' },
        global_persons: { display_name: '', given_name: 'Joachim', family_name: 'Meyer' },
      },
      captures,
    );
    const svc = makeSvc(supabase);

    await svc.addInstructor('w-1', 'gp-2', 'user-1');

    expect(captures['workshop_instructors.upsert']?.[0]).toMatchObject({
      display_name: 'Joachim Meyer',
    });
  });

  it('tagEventInstructor upserts an event_instructors row for a global person', async () => {
    const captures: Record<string, unknown[]> = {};
    const supabase = buildSupabase(
      {
        events: { organization_id: 'org-1' },
        global_persons: { id: 'gp-9' },
      },
      captures,
    );
    const svc = makeSvc(supabase);

    await svc.tagEventInstructor('event-1', 'gp-9', 'user-1');

    expect(captures['event_instructors.upsert']?.[0]).toMatchObject({
      event_id: 'event-1',
      person_id: 'gp-9',
    });
  });
});
