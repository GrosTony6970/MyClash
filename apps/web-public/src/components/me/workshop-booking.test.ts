import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bookingsOf, enrollPath } from './workshop-booking';
import type { PersonSchedule, WorkshopEnrollment } from './types';

const workshop = (
  workshopId: string,
  status?: WorkshopEnrollment['status'],
): WorkshopEnrollment => ({
  workshopId,
  workshopSlug: workshopId,
  workshopName: workshopId,
  sessionStart: null,
  sessionEnd: null,
  location: null,
  ...(status ? { status } : {}),
});

const schedule = (over: Partial<PersonSchedule>): PersonSchedule => ({
  personId: 'p-tom',
  matches: [],
  refereeSlots: [],
  workshops: [],
  ...over,
});

describe('bookingsOf', () => {
  it('tells a seat, a waitlist place and a refusal apart, by session', () => {
    const bookings = bookingsOf(
      schedule({
        workshops: [workshop('s-seat', 'confirmed'), workshop('s-wait', 'waitlisted')],
        refusedWorkshopIds: ['s-refused'],
      }),
    );

    expect([...bookings]).toEqual([
      ['s-seat', 'confirmed'],
      ['s-wait', 'waitlisted'],
      ['s-refused', 'refused'],
    ]);
    expect(bookings.get('s-other')).toBeUndefined();
  });

  it('reads a copy cached before the API sent the status as seats, with no refusal', () => {
    expect([...bookingsOf(schedule({ workshops: [workshop('s-old')] }))]).toEqual([
      ['s-old', 'confirmed'],
    ]);
  });

  it('books nothing while the schedule is not loaded, or hidden', () => {
    expect(bookingsOf(null).size).toBe(0);
    expect(bookingsOf(schedule({ workshops: null })).size).toBe(0);
  });
});

describe('enrollPath', () => {
  it('asks the API to remove a refusal first, in the same call, and only for a refusal', () => {
    expect(enrollPath('s-1', 'refused')).toBe('/api/v1/workshop-sessions/s-1/enroll?again=true');
    for (const booking of ['none', 'confirmed', 'waitlisted'] as const) {
      expect(enrollPath('s-1', booking)).toBe('/api/v1/workshop-sessions/s-1/enroll');
    }
  });
});

// web-public's vitest does not compile TSX: the screens are pinned as text.
const source = (path: string) => readFileSync(resolve(__dirname, '../../..', path), 'utf8');

describe('the screens that show a booking', () => {
  it('the Workshops page takes each card from the booking, never from "is in the list"', () => {
    const page = source('app/me/events/[eventSlug]/workshops/page.tsx');
    expect(page).toContain('const bookings = useMemo(() => bookingsOf(schedule), [schedule]);');
    expect(page).toContain("const booking = bookings.get(session.id) ?? 'none';");
    expect(page).toContain("onRegister={() => void act(session.id, 'POST', booking)}");
    expect(page).toContain("onCancel={() => void act(session.id, 'DELETE')}");
    // Only a seat is highlighted and rated.
    expect(page).toContain("highlighted={booking === 'confirmed'}");
    expect(page).toContain("{booking === 'confirmed' && started && (");
    expect(page).not.toContain('enrolledIds');
  });

  it('one tap is one call: the page never cancels a refusal and then books', () => {
    const page = source('app/me/events/[eventSlug]/workshops/page.tsx');
    expect(page).toContain('await fetch(`${api}${enrollPath(sessionId, booking)}`, {');
    expect(page.match(/await fetch\(`\$\{api\}\$\{enrollPath/g)).toHaveLength(1);
  });

  it('the controls say each state in its own words', () => {
    const controls = source('src/components/me/WorkshopRegisterControls.tsx');
    expect(controls).toContain('<BookingNotice booking={booking} labels={labels} />');
    expect(controls).toMatch(
      /if \(booking === 'confirmed'\) \{\s+return \(\s+<p[^>]*>\s+<CheckIcon \/>\s+\{labels\.registered\}/,
    );
    expect(controls).toMatch(
      /if \(booking === 'waitlisted'\) \{\s+return \(\s+<p[^>]*>\s+\{labels\.onWaitlist\}/,
    );
    expect(controls).toMatch(
      /if \(booking === 'refused'\) \{\s+return <p[^>]*>\{labels\.refused\}/,
    );
  });

  it('the button cancels a seat, leaves a waitlist, or books a refused viewer again', () => {
    const controls = source('src/components/me/WorkshopRegisterControls.tsx');
    expect(controls).toContain(
      "const booked = booking === 'confirmed' || booking === 'waitlisted';",
    );
    expect(controls).toMatch(
      /\{booked \? \(\s+<Button[^>]*onClick=\{onCancel\}>\s+\{booking === 'waitlisted' \? labels\.leaveWaitlist : labels\.cancel\}/,
    );
    expect(controls).toMatch(
      /booking === 'refused' \? \(\s+<Button[^>]*onClick=\{onRegister\}>\s+\{labels\.registerAgain\}/,
    );
  });

  it('the three schedules mark a waitlist place', () => {
    const mark = String.raw`t\('publicApp\.me\.workshops\.onWaitlist'\)`;
    expect(source('src/components/me/ScheduleView.tsx')).toMatch(
      new RegExp(String.raw`w\.status === 'waitlisted'\s+\? \{ label: ${mark}, tone: 'pending' \}`),
    );
    expect(source('app/me/events/[eventSlug]/page.tsx')).toMatch(
      new RegExp(String.raw`w\.involvement === 'waitlisted' \? \(\s+<span[^>]*>\s+\{${mark}\}`),
    );
    const publicPage = source('app/e/[eventSlug]/my-schedule/page.tsx');
    expect(publicPage).toMatch(
      new RegExp(String.raw`\{workshop\.status === 'waitlisted' && \(\s+<p[^>]*>\{${mark}\}`),
    );
    expect(publicPage).toContain('<WorkshopLines workshop={item.data} />');
  });
});
