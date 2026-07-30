import { test, expect } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, type Api } from './_api';
import { ensureRoster, type Person } from './_bracket';

/**
 * Workshops: 31 endpoints, zero assertions before this (run with
 * `E2E_WORKSHOPS=1`).
 *
 * `07-populate-event.spec.ts` touches them, but its `step()` helper catches
 * every error and carries on — 1714 lines, 10 `expect`s, excluded from the
 * nightly. So nothing has ever checked what these endpoints DO.
 *
 * That matters more here than almost anywhere else in the app, because **the
 * failure mode is silent mis-allocation, not a throw**. A seat given to the
 * wrong person reads exactly like a seat given to the right one; a waitlist
 * promoted out of order looks identical to one promoted in order. Every
 * assertion below is therefore about WHICH PERSON ended up in WHICH SLOT, never
 * about counts alone.
 *
 * `POST workshops/:id/notify` is deliberately out of scope — it messages real
 * people. Same rule that keeps `15` on a club-kind event.
 *
 * SAFE BY CONSTRUCTION, NOT BY LUCK: promotion calls
 * `notificationEvents.waitlistPromoted`, which returns early unless the person
 * has a `claimed_by_user_id`. Every attendee here comes from `ensureRoster` and
 * is unclaimed, so no message is ever sent. Do not enrol a claimed person.
 *
 * Event-scoped, so `global-teardown` cleans it up.
 */
const WORKSHOPS = ['1', 'true', 'yes'].includes((process.env.E2E_WORKSHOPS ?? '').toLowerCase());

/** Seats in the workshop. Small on purpose: 5 attendees means 2 in, 3 waiting. */
const CAPACITY = 2;

interface RosterRow {
  id: string;
  status: 'confirmed' | 'waitlisted' | 'refused';
  waitlistPosition: number | null;
  personId: string | null;
  persons: { id: string; givenName: string; familyName: string } | null;
}

interface WorkshopRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  capacity: number | null;
  weapon?: string | null;
  level?: string | null;
}

test.describe('workshops', () => {
  test.skip(!WORKSHOPS, 'set E2E_WORKSHOPS=1 to drive enrolment, the waitlist and instructors');

  test('capacity, waitlist order, promotion and the instructor surfaces', async ({ request }) => {
    test.setTimeout(180_000);
    const api = apiFor(request);
    const { eventId, eventSlug } = runContext();
    const token = Date.now().toString(36);

    // ── A workshop with two seats and five people who want them ───────────────
    const workshop = await api.json<WorkshopRow>(
      await api.post(`events/${eventId}/workshops`, {
        data: {
          slug: `ws-${token}`,
          title: `E2E Workshop ${token}`,
          shortDescription: 'Seats, a waitlist, and who ends up where.',
          capacity: CAPACITY,
          durationMinutes: 60,
          status: 'draft',
        },
      }),
    );

    const session = await api.json<{ id: string }>(
      await api.post(`workshops/${workshop.id}/sessions`, {
        data: {
          startTime: '2099-01-01T10:00:00.000Z',
          endTime: '2099-01-01T11:00:00.000Z',
          location: `Room ${token}`,
        },
      }),
    );

    // Distinct names so the roster can be read back BY PERSON, which is the
    // whole point — a count would pass no matter who got the seat.
    const attendees = await ensureRoster(api, eventId, [
      { givenName: 'Wsattend', familyName: 'One' },
      { givenName: 'Wsattend', familyName: 'Two' },
      { givenName: 'Wsattend', familyName: 'Three' },
      { givenName: 'Wsattend', familyName: 'Four' },
      { givenName: 'Wsattend', familyName: 'Five' },
    ]);
    const [one, two, three, four, five] = attendees as [Person, Person, Person, Person, Person];

    const roster = () => readRoster(api, session.id);

    // Enrolled ONE AT A TIME, in order: the waitlist position is assigned from
    // the count of people already waiting, so a batch would prove nothing about
    // ordering.
    for (const person of attendees) {
      await api.ok(await api.post(`workshop-sessions/${session.id}/enrollments/${person.id}`));
    }

    // ── 1) The first two sit; the rest queue, in arrival order ────────────────
    expect(
      await roster(),
      'two seats go to the first two to arrive, and the queue keeps arrival order',
    ).toEqual({
      [key(one)]: { status: 'confirmed', waitlistPosition: null },
      [key(two)]: { status: 'confirmed', waitlistPosition: null },
      [key(three)]: { status: 'waitlisted', waitlistPosition: 1 },
      [key(four)]: { status: 'waitlisted', waitlistPosition: 2 },
      [key(five)]: { status: 'waitlisted', waitlistPosition: 3 },
    });

    // ── 2) Freeing a seat promotes the TOP of the queue, and re-numbers ───────
    // The sharpest assertion in the spec. Promoting anyone at all would satisfy
    // a count; only naming the person proves it took the top, and only checking
    // 4 and 5 proves `recompactWaitlist` closed the gap instead of leaving a
    // hole at position 1.
    await api.ok(await api.post(`workshop-sessions/${session.id}/enrollments/${one.id}/refuse`));
    expect(
      await roster(),
      'the freed seat goes to the FIRST person waiting, and the queue closes up behind them',
    ).toEqual({
      [key(one)]: { status: 'refused', waitlistPosition: null },
      [key(two)]: { status: 'confirmed', waitlistPosition: null },
      [key(three)]: { status: 'confirmed', waitlistPosition: null },
      [key(four)]: { status: 'waitlisted', waitlistPosition: 1 },
      [key(five)]: { status: 'waitlisted', waitlistPosition: 2 },
    });

    // ── 3) A refused person cannot quietly re-register ────────────────────────
    const reEnrol = await api.post(`workshop-sessions/${session.id}/enrollments/${one.id}`);
    const reEnrolBody = await reEnrol.text();
    expect(reEnrol.status(), `re-enrolling a refused person: ${reEnrolBody.slice(0, 200)}`).toBe(
      403,
    );
    expect(reEnrolBody, 'the refusal must say why').toMatch(/removed from this workshop/i);
    expect(
      (await roster())[key(one)],
      'a blocked re-registration must not resurrect the row either',
    ).toEqual({ status: 'refused', waitlistPosition: null });

    // ── 4) `promote` only applies to someone actually waiting ─────────────────
    const promoteSeated = await api.post(`workshop-sessions/${session.id}/promote/${two.id}`);
    expect(
      promoteSeated.status(),
      `promoting an already-seated person: ${(await promoteSeated.text()).slice(0, 200)}`,
    ).toBe(400);

    await api.ok(await api.post(`workshop-sessions/${session.id}/promote/${four.id}`));
    expect(
      await roster(),
      'an explicit promotion seats that person and closes the queue behind them',
    ).toEqual({
      [key(one)]: { status: 'refused', waitlistPosition: null },
      [key(two)]: { status: 'confirmed', waitlistPosition: null },
      [key(three)]: { status: 'confirmed', waitlistPosition: null },
      [key(four)]: { status: 'confirmed', waitlistPosition: null },
      [key(five)]: { status: 'waitlisted', waitlistPosition: 1 },
    });

    // ── 5) `accept` seats the last one waiting — over capacity, on purpose ────
    // An instructor accepting someone is a deliberate override; the seat count
    // is now 4 against a capacity of 2, and that is correct.
    await api.ok(await api.post(`workshop-sessions/${session.id}/enrollments/${five.id}/accept`));
    const seated = Object.values(await roster()).filter((r) => r.status === 'confirmed');
    expect(
      seated.length,
      'accept is an override: the instructor may seat past capacity',
    ).toBeGreaterThan(CAPACITY);
    expect((await roster())[key(five)]).toEqual({
      status: 'confirmed',
      waitlistPosition: null,
    });

    // ── 6) Instructors ────────────────────────────────────────────────────────
    // `workshops.instructors` keys on global_persons.id, while enrolment keys on
    // the event-scoped persons.id — two different identities for one human, and
    // mixing them up is exactly the class of bug this family keeps finding.
    const globalIdOf = await globalPersonIds(api, eventId);
    const instructorGlobalId = globalIdOf.get(three.id);
    expect(instructorGlobalId, 'the instructor needs a global profile to be linked').toBeTruthy();

    await api.ok(
      await api.post(`workshops/${workshop.id}/instructors`, {
        data: { globalPersonId: instructorGlobalId },
      }),
    );
    expect(
      await instructorIds(api, workshop.id),
      'the workshop must list the instructor that was just added',
    ).toContain(instructorGlobalId);

    // The instructor-scoped edit — four fields, and only those four.
    await api.ok(
      await api.patch(`workshops/${workshop.id}/instructor`, {
        data: { weapon: 'longsword', level: 'intermediate' },
      }),
    );
    const edited = await api.json<WorkshopRow>(await api.get(`workshops/${workshop.id}`));
    // `level` is free text and comes back verbatim. `weapon` does NOT: it is
    // resolved against `weapon_catalog` and stored under the catalog's own
    // casing (`resolveCatalogWeapon`), so this compares case-insensitively
    // rather than pinning today's catalog spelling.
    expect(edited.level).toBe('intermediate');
    expect(edited.weapon?.toLowerCase()).toBe('longsword');

    // The rule behind that canonicalisation, which is the part worth pinning:
    // a weapon outside the active catalog is refused outright, so a workshop can
    // never advertise a discipline the event does not actually run.
    const badWeapon = await api.patch(`workshops/${workshop.id}/instructor`, {
      data: { weapon: `not-a-weapon-${token}` },
    });
    expect(
      badWeapon.status(),
      `an off-catalog weapon must be refused: ${(await badWeapon.text()).slice(0, 200)}`,
    ).toBe(400);
    expect(
      (
        await api.json<WorkshopRow>(await api.get(`workshops/${workshop.id}`))
      ).weapon?.toLowerCase(),
      'a refused edit must leave the previous weapon alone',
    ).toBe('longsword');

    await api.ok(await api.delete(`workshops/${workshop.id}/instructors/${instructorGlobalId}`));
    expect(
      await instructorIds(api, workshop.id),
      'removing the instructor must actually remove them',
    ).not.toContain(instructorGlobalId);

    // The event-level instructor roster is a separate list, and it is ASYMMETRIC
    // on purpose: `tagEventInstructor`/`untagEventInstructor` accept either id
    // and resolve it through `resolveGlobalPersonId`, but `event_instructors`
    // stores the GLOBAL id — which `listEventInstructors` then returns under a
    // field called `personId`. Writing with the event-scoped id and reading back
    // the global one is the behaviour; pin it, because a future reader comparing
    // the two `personId`s directly would otherwise conclude the tag silently
    // failed.
    const twoGlobalId = globalIdOf.get(two.id);
    expect(twoGlobalId, 'the instructor needs a global profile to be tagged').toBeTruthy();

    await api.ok(await api.post(`events/${eventId}/instructors/${two.id}`));
    const tagged = await eventInstructorPersonIds(api, eventId);
    expect(tagged, 'the event roster reports the GLOBAL id, not the one that was posted').toContain(
      twoGlobalId,
    );
    expect(tagged, 'and never the event-scoped id').not.toContain(two.id);

    // Untag takes the event-scoped id too — if it resolved differently from tag,
    // this would silently no-op and the instructor would stay on the roster.
    await api.ok(await api.delete(`events/${eventId}/instructors/${two.id}`));
    expect(
      await eventInstructorPersonIds(api, eventId),
      'untag must resolve the same identity tag did, or removal never happens',
    ).not.toContain(twoGlobalId);

    // ── 7) Workshop breaks ────────────────────────────────────────────────────
    const brk = await api.json<{ id: string }>(
      await api.post(`events/${eventId}/workshop-breaks`, {
        data: { dayIndex: 0, startTime: '12:00', endTime: '13:00', label: `Lunch ${token}` },
      }),
    );
    await api.ok(await api.patch(`workshop-breaks/${brk.id}`, { data: { endTime: '13:30' } }));
    const breaks = await api.json<Array<{ id: string; end_time?: string; endTime?: string }>>(
      await api.get(`events/${eventId}/workshop-breaks`),
    );
    const updated = breaks.find((b) => b.id === brk.id);
    expect(updated, 'the break must survive its own update').toBeDefined();
    expect(
      String(updated?.end_time ?? updated?.endTime ?? ''),
      'the edit must be what the list returns',
    ).toMatch(/^13:30/);
    await api.ok(await api.delete(`workshop-breaks/${brk.id}`));
    expect(
      (
        await api.json<Array<{ id: string }>>(await api.get(`events/${eventId}/workshop-breaks`))
      ).map((b) => b.id),
      'a deleted break must be gone',
    ).not.toContain(brk.id);

    // ── 8) The public read is STATUS-GATED ────────────────────────────────────
    // `PUBLIC_WORKSHOP_STATUSES` is published/running/completed. A draft
    // workshop leaking to the public list would expose an event's programme
    // before its organizer meant to.
    expect(
      await publicSlugs(api, eventSlug),
      'a DRAFT workshop must not be publicly listed',
    ).not.toContain(workshop.slug);

    await api.ok(await api.patch(`workshops/${workshop.id}`, { data: { status: 'published' } }));
    expect(
      await publicSlugs(api, eventSlug),
      'once published it must appear — this run created it, so no fixture can satisfy this',
    ).toContain(workshop.slug);

    // Put it back, so a preserved test event is not left advertising a workshop.
    await api.ok(await api.patch(`workshops/${workshop.id}`, { data: { status: 'draft' } }));
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Roster keyed by person name, so a failure names the human, not a uuid. */
const key = (p: Person) => `${p.givenName} ${p.familyName}`;

async function readRoster(
  api: Api,
  sessionId: string,
): Promise<Record<string, { status: string; waitlistPosition: number | null }>> {
  const rows = await api.json<RosterRow[]>(await api.get(`workshop-sessions/${sessionId}/roster`));
  const out: Record<string, { status: string; waitlistPosition: number | null }> = {};
  for (const row of rows) {
    const name = row.persons ? `${row.persons.givenName} ${row.persons.familyName}` : row.personId;
    out[String(name)] = { status: row.status, waitlistPosition: row.waitlistPosition };
  }
  return out;
}

/** event-scoped persons.id → global_persons.id, the other identity. */
async function globalPersonIds(api: Api, eventId: string): Promise<Map<string, string>> {
  const persons = await api.json<Array<{ id: string; globalPersonId: string | null }>>(
    await api.get(`events/${eventId}/persons`),
  );
  return new Map(persons.filter((p) => p.globalPersonId).map((p) => [p.id, p.globalPersonId!]));
}

async function instructorIds(api: Api, workshopId: string): Promise<string[]> {
  const workshop = await api.json<{
    instructors?: Array<{ globalPersonId?: string; global_person_id?: string; id?: string }>;
  }>(await api.get(`workshops/${workshopId}`));
  return (workshop.instructors ?? []).map((i) =>
    String(i.globalPersonId ?? i.global_person_id ?? i.id),
  );
}

async function eventInstructorPersonIds(api: Api, eventId: string): Promise<string[]> {
  const rows = await api.json<Array<{ personId?: string; person_id?: string; id?: string }>>(
    await api.get(`events/${eventId}/instructors`),
  );
  return rows.map((r) => String(r.personId ?? r.person_id ?? r.id));
}

async function publicSlugs(api: Api, eventSlug: string): Promise<string[]> {
  const rows = await api.json<Array<{ slug: string }>>(
    await api.get(`events/${eventSlug}/public-workshops`),
  );
  return rows.map((r) => r.slug);
}
