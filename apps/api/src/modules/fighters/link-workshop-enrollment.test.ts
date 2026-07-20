/**
 * link-workshop-enrollment.test.ts
 *
 * An instructor holds no participant seat in a workshop they teach — enforced
 * on self-enrollment in EnrollmentService.enroll. This organizer-only linking
 * endpoint is the back door into the same state (attach an orphan enrollment
 * to a global person who happens to instruct that workshop), so it carries the
 * same guard.
 */

import { describe, it, expect } from 'vitest';
import { FightersService } from './fighters.service';

/**
 * Minimal Supabase stub covering the three query shapes the guard + update use:
 *   workshop_enrollments .select(…).eq('id',…).maybeSingle()   → parent workshop
 *   workshop_instructors .select(…).eq(…).eq(…).maybeSingle()  → is-instructor
 *   workshop_enrollments .update(…).eq(…).is(…)                → the write
 */
function buildFake(opts: {
  /** Parent workshop of the enrollment; null models a missing/odd embed. */
  workshopId: string | null;
  /** global_persons.id values tagged as instructors of `workshopId`. */
  instructorGlobalIds?: string[];
  /** PostgREST embeds to-one as an object, but can arrive as an array. */
  embedAsArray?: boolean;
}) {
  const updates: Array<Record<string, unknown>> = [];

  function table(name: string) {
    if (name === 'workshop_instructors') {
      const filters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        maybeSingle: () => {
          const hit =
            filters['workshop_id'] === opts.workshopId &&
            (opts.instructorGlobalIds ?? []).includes(filters['global_person_id'] as string);
          return Promise.resolve({ data: hit ? { id: 'wi-1' } : null, error: null });
        },
      };
      return builder;
    }

    // workshop_enrollments — read (guard) and write (link) share one builder.
    let updatePayload: Record<string, unknown> | null = null;
    const session = opts.workshopId === null ? null : ({ workshop_id: opts.workshopId } as const);
    const builder: Record<string, unknown> = {
      select: () => builder,
      update: (payload: Record<string, unknown>) => {
        updatePayload = payload;
        return builder;
      },
      eq: () => builder,
      is: () => {
        if (updatePayload) updates.push(updatePayload);
        return Promise.resolve({ data: null, error: null });
      },
      maybeSingle: () =>
        Promise.resolve({
          data: {
            workshop_sessions: session === null ? null : opts.embedAsArray ? [session] : session,
          },
          error: null,
        }),
    };
    return builder;
  }

  return { supabase: { service: { from: (n: string) => table(n) } }, updates };
}

function buildService(supabase: object): FightersService {
  return new FightersService(supabase as never, {} as never, {} as never);
}

describe('FightersService.linkWorkshopEnrollment', () => {
  it('rejects linking an enrollment to an instructor of that same workshop', async () => {
    const fake = buildFake({ workshopId: 'w-1', instructorGlobalIds: ['gp-teacher'] });
    const svc = buildService(fake.supabase);

    await expect(svc.linkWorkshopEnrollment('e-1', 'gp-teacher')).rejects.toThrow(/teach/i);
    expect(fake.updates).toHaveLength(0);
  });

  it('rejects it too when PostgREST embeds the session as an array', async () => {
    const fake = buildFake({
      workshopId: 'w-1',
      instructorGlobalIds: ['gp-teacher'],
      embedAsArray: true,
    });
    const svc = buildService(fake.supabase);

    await expect(svc.linkWorkshopEnrollment('e-1', 'gp-teacher')).rejects.toThrow(/teach/i);
    expect(fake.updates).toHaveLength(0);
  });

  it('links a person who does not teach the workshop', async () => {
    const fake = buildFake({ workshopId: 'w-1', instructorGlobalIds: ['gp-teacher'] });
    const svc = buildService(fake.supabase);

    await svc.linkWorkshopEnrollment('e-1', 'gp-attendee');

    expect(fake.updates).toEqual([{ global_person_id: 'gp-attendee' }]);
  });

  it('links when the parent workshop cannot be resolved (nothing to guard against)', async () => {
    const fake = buildFake({ workshopId: null, instructorGlobalIds: ['gp-teacher'] });
    const svc = buildService(fake.supabase);

    await svc.linkWorkshopEnrollment('e-1', 'gp-teacher');

    expect(fake.updates).toEqual([{ global_person_id: 'gp-teacher' }]);
  });
});
