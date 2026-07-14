/**
 * enrollment.service.test.ts — T-802
 *
 * Behaviours (against the REAL schema: workshop_session_id, user_id,
 * position; capacity from workshops.capacity, null ⇒ unlimited):
 *   - confirmed when there is space
 *   - waitlisted at/over capacity, with a position
 *   - unlimited (always confirmed) when workshops.capacity is null
 *   - enroll is idempotent
 *   - cancelling a confirmed seat promotes the top of the waitlist
 *   - inserts use workshop_session_id / user_id / position (not the legacy names)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EnrollmentService } from './enrollment.service';

interface Row {
  id: string;
  workshop_session_id: string;
  user_id: string;
  status: 'confirmed' | 'waitlisted' | 'refused';
  position: number | null;
}

/**
 * A tiny in-memory Supabase fake that supports just the query shapes the
 * service uses. Records inserts/updates/deletes so tests can assert on
 * real column names and verify promotion behaviour through the public API.
 */
function buildFake(opts: {
  capacity: number | null;
  seed?: Row[];
  personGlobalId?: string | null;
  personsError?: { message: string } | null;
  globalUpdateError?: { message: string } | null;
}) {
  const rows: Row[] = [...(opts.seed ?? [])];
  let idc = rows.length;
  const inserts: Record<string, unknown>[] = [];
  const globalUpdates: Array<{
    payload: Record<string, unknown> | null;
    filters: Record<string, unknown>;
  }> = [];

  function table(name: string) {
    if (name === 'workshop_sessions') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { workshop_id: 'w-1', workshops: { capacity: opts.capacity } },
                error: null,
              }),
          }),
        }),
      };
    }
    if (name === 'persons') {
      // markGlobalWorkshopParticipant resolves personId → global_person_id.
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data:
                  opts.personGlobalId === undefined
                    ? null
                    : { global_person_id: opts.personGlobalId },
                error: opts.personsError ?? null,
              }),
          }),
        }),
      };
    }
    if (name === 'global_persons') {
      // Records the is_workshop_participant tick for assertions.
      let payload: Record<string, unknown> | null = null;
      const filters: Record<string, unknown> = {};
      const gpBuilder: Record<string, unknown> = {
        update: (p: Record<string, unknown>) => {
          payload = p;
          return gpBuilder;
        },
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return gpBuilder;
        },
        then: (resolve: (v: { data: null; error: { message: string } | null }) => unknown) => {
          globalUpdates.push({ payload, filters });
          return resolve({ data: null, error: opts.globalUpdateError ?? null });
        },
      };
      return gpBuilder;
    }
    // workshop_enrollments — a chainable filter builder.
    const filters: { col: string; val: unknown }[] = [];
    let op: 'select' | 'count' | 'insert' | 'update' | 'delete' = 'select';
    let countMode = false;
    let updatePayload: Record<string, unknown> | null = null;
    let orderCol: string | null = null;
    let limitN: number | null = null;

    const matched = () =>
      rows.filter((r) =>
        filters.every((f) => (r as unknown as Record<string, unknown>)[f.col] === f.val),
      );

    const builder: Record<string, unknown> = {
      select: (_cols: string, cfg?: { count?: string; head?: boolean }) => {
        op = 'select';
        if (cfg?.count) countMode = true;
        return builder;
      },
      insert: (payload: Record<string, unknown>) => {
        op = 'insert';
        inserts.push(payload);
        const row: Row = {
          id: `e-${++idc}`,
          workshop_session_id: payload['workshop_session_id'] as string,
          user_id: payload['user_id'] as string,
          status: payload['status'] as 'confirmed' | 'waitlisted',
          position: (payload['position'] as number | null) ?? null,
        };
        rows.push(row);
        return {
          select: () => ({ single: () => Promise.resolve({ data: { id: row.id }, error: null }) }),
        };
      },
      update: (payload: Record<string, unknown>) => {
        op = 'update';
        updatePayload = payload;
        return builder;
      },
      delete: () => {
        op = 'delete';
        return builder;
      },
      eq: (col: string, val: unknown) => {
        filters.push({ col, val });
        if (op === 'update' || op === 'delete') {
          const hits = matched();
          if (op === 'delete') {
            for (const h of hits) rows.splice(rows.indexOf(h), 1);
          } else if (updatePayload) {
            for (const h of hits) Object.assign(h, updatePayload);
          }
        }
        return builder;
      },
      order: (col: string) => {
        orderCol = col;
        return builder;
      },
      limit: (n: number) => {
        limitN = n;
        return builder;
      },
      maybeSingle: () => {
        let list = matched();
        if (orderCol) {
          list = [...list].sort(
            (a, b) =>
              ((a as unknown as Record<string, number>)[orderCol!] ?? 0) -
              ((b as unknown as Record<string, number>)[orderCol!] ?? 0),
          );
        }
        if (limitN) list = list.slice(0, limitN);
        return Promise.resolve({ data: list[0] ?? null, error: null });
      },
      // Count queries (head:true) are awaited directly.
      then: (resolve: (v: { count: number; data: Row[]; error: null }) => unknown) => {
        let list = matched();
        if (orderCol) {
          list = [...list].sort(
            (a, b) =>
              ((a as unknown as Record<string, number>)[orderCol!] ?? 0) -
              ((b as unknown as Record<string, number>)[orderCol!] ?? 0),
          );
        }
        return resolve({ count: countMode ? list.length : list.length, data: list, error: null });
      },
    };
    return builder;
  }

  return {
    supabase: { service: { from: (n: string) => table(n) }, anon: {} },
    rows,
    inserts,
    globalUpdates,
  };
}

const notif = { waitlistPromoted: vi.fn().mockResolvedValue(undefined) };

describe('EnrollmentService.enroll', () => {
  beforeEach(() => vi.clearAllMocks());

  it('confirms when there is space', async () => {
    const fake = buildFake({ capacity: 2 });
    const svc = new EnrollmentService(fake.supabase as never, notif as never);

    const res = await svc.enroll('s-1', 'person-1');

    expect(res.status).toBe('confirmed');
    expect(res.waitlistPosition).toBeNull();
    expect(fake.inserts[0]).toMatchObject({
      workshop_session_id: 's-1',
      user_id: 'person-1',
      status: 'confirmed',
      position: null,
    });
  });

  it('waitlists at capacity with the next position', async () => {
    const fake = buildFake({
      capacity: 1,
      seed: [
        {
          id: 'e-1',
          workshop_session_id: 's-1',
          user_id: 'p-a',
          status: 'confirmed',
          position: null,
        },
      ],
    });
    const svc = new EnrollmentService(fake.supabase as never, notif as never);

    const res = await svc.enroll('s-1', 'p-b');

    expect(res.status).toBe('waitlisted');
    expect(res.waitlistPosition).toBe(1);
    expect(fake.inserts[0]).toMatchObject({ status: 'waitlisted', position: 1, user_id: 'p-b' });
  });

  it('always confirms when workshop capacity is null (unlimited)', async () => {
    const fake = buildFake({
      capacity: null,
      seed: Array.from({ length: 50 }, (_, i) => ({
        id: `e-${i}`,
        workshop_session_id: 's-1',
        user_id: `p-${i}`,
        status: 'confirmed' as const,
        position: null,
      })),
    });
    const svc = new EnrollmentService(fake.supabase as never, notif as never);

    const res = await svc.enroll('s-1', 'p-new');
    expect(res.status).toBe('confirmed');
  });

  it('is idempotent — returns the existing row without inserting', async () => {
    const fake = buildFake({
      capacity: 5,
      seed: [
        {
          id: 'e-9',
          workshop_session_id: 's-1',
          user_id: 'p-1',
          status: 'confirmed',
          position: null,
        },
      ],
    });
    const svc = new EnrollmentService(fake.supabase as never, notif as never);

    const res = await svc.enroll('s-1', 'p-1');
    expect(res.id).toBe('e-9');
    expect(fake.inserts).toHaveLength(0);
  });

  it('blocks re-registration when the person was refused by the instructor', async () => {
    const fake = buildFake({
      capacity: 5,
      seed: [
        {
          id: 'e-r',
          workshop_session_id: 's-1',
          user_id: 'p-refused',
          status: 'refused',
          position: null,
        },
      ],
    });
    const svc = new EnrollmentService(fake.supabase as never, notif as never);

    await expect(svc.enroll('s-1', 'p-refused')).rejects.toThrow(/instructor/i);
    expect(fake.inserts).toHaveLength(0);
  });

  it('ticks global_persons.is_workshop_participant when the person has a global link', async () => {
    const fake = buildFake({ capacity: 2, personGlobalId: 'gp-42' });
    const svc = new EnrollmentService(fake.supabase as never, notif as never);

    await svc.enroll('s-1', 'person-1');

    expect(fake.globalUpdates).toHaveLength(1);
    const [gu] = fake.globalUpdates;
    expect(gu?.payload).toMatchObject({ is_workshop_participant: true });
    expect(gu?.filters).toMatchObject({ id: 'gp-42', is_workshop_participant: false });
  });

  it('does not touch global_persons when the person has no global link', async () => {
    const fake = buildFake({ capacity: 2, personGlobalId: null });
    const svc = new EnrollmentService(fake.supabase as never, notif as never);

    const res = await svc.enroll('s-1', 'guest-1');

    expect(res.status).toBe('confirmed');
    expect(fake.globalUpdates).toHaveLength(0);
  });

  it('still enrolls when the global_persons flag update fails', async () => {
    const fake = buildFake({
      capacity: 2,
      personGlobalId: 'gp-42',
      globalUpdateError: { message: 'boom' },
    });
    const svc = new EnrollmentService(fake.supabase as never, notif as never);

    const res = await svc.enroll('s-1', 'person-1');

    expect(res.status).toBe('confirmed');
    expect(fake.inserts[0]).toMatchObject({ user_id: 'person-1', status: 'confirmed' });
  });
});

describe('EnrollmentService.cancel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('promotes the top waitlisted person when a confirmed seat is freed', async () => {
    const fake = buildFake({
      capacity: 1,
      seed: [
        {
          id: 'e-c',
          workshop_session_id: 's-1',
          user_id: 'p-conf',
          status: 'confirmed',
          position: null,
        },
        {
          id: 'e-w',
          workshop_session_id: 's-1',
          user_id: 'p-wait',
          status: 'waitlisted',
          position: 1,
        },
      ],
    });
    const svc = new EnrollmentService(fake.supabase as never, notif as never);

    await svc.cancel('s-1', 'p-conf');

    const promoted = fake.rows.find((r) => r.user_id === 'p-wait');
    expect(promoted?.status).toBe('confirmed');
    expect(promoted?.position).toBeNull();
    expect(fake.rows.find((r) => r.user_id === 'p-conf')).toBeUndefined();
    expect(notif.waitlistPromoted).toHaveBeenCalledWith('s-1', 'p-wait');
  });
});

describe('EnrollmentService.accept', () => {
  beforeEach(() => vi.clearAllMocks());

  it('promotes a waitlisted person to confirmed and notifies', async () => {
    const fake = buildFake({
      capacity: 1,
      seed: [
        {
          id: 'e-w',
          workshop_session_id: 's-1',
          user_id: 'p-w',
          status: 'waitlisted',
          position: 1,
        },
      ],
    });
    const svc = new EnrollmentService(fake.supabase as never, notif as never);

    await svc.accept('s-1', 'p-w');

    expect(fake.rows.find((r) => r.user_id === 'p-w')?.status).toBe('confirmed');
    expect(notif.waitlistPromoted).toHaveBeenCalledWith('s-1', 'p-w');
  });

  it('reinstates a refused person to confirmed without notifying', async () => {
    const fake = buildFake({
      capacity: 5,
      seed: [
        {
          id: 'e-r',
          workshop_session_id: 's-1',
          user_id: 'p-r',
          status: 'refused',
          position: null,
        },
      ],
    });
    const svc = new EnrollmentService(fake.supabase as never, notif as never);

    await svc.accept('s-1', 'p-r');

    expect(fake.rows.find((r) => r.user_id === 'p-r')?.status).toBe('confirmed');
    expect(notif.waitlistPromoted).not.toHaveBeenCalled();
  });
});

describe('EnrollmentService.refuse', () => {
  beforeEach(() => vi.clearAllMocks());

  it('soft-removes a confirmed attendee and promotes the waitlist', async () => {
    const fake = buildFake({
      capacity: 1,
      seed: [
        {
          id: 'e-c',
          workshop_session_id: 's-1',
          user_id: 'p-c',
          status: 'confirmed',
          position: null,
        },
        {
          id: 'e-w',
          workshop_session_id: 's-1',
          user_id: 'p-w',
          status: 'waitlisted',
          position: 1,
        },
      ],
    });
    const svc = new EnrollmentService(fake.supabase as never, notif as never);

    await svc.refuse('s-1', 'p-c');

    // The refused person keeps a row (sticky) with status 'refused'.
    expect(fake.rows.find((r) => r.user_id === 'p-c')?.status).toBe('refused');
    // The freed seat promotes the top of the waitlist.
    expect(fake.rows.find((r) => r.user_id === 'p-w')?.status).toBe('confirmed');
  });
});
