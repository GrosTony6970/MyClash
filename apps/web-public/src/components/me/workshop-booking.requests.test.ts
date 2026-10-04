import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeBooking, readBookings } from './workshop-booking';

/**
 * A guest books on the public Workshop page and sees her booking there (operator ruling 261).
 *
 * The page used to look for a login cookie before it sent anything. Both login cookies are
 * httpOnly, so the look always failed: everybody read "Sign in to enroll" and no request left
 * the phone. The server now says who the caller is, on the booking call itself and on the read
 * of her own schedule.
 *
 * This package's vitest does not compile TSX: the requests live in a pure module, driven here,
 * and the page is read as text for the wiring.
 */

const API = 'https://api.example.test';
const fetchMock = vi.fn();
const answer = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const sent = () => fetchMock.mock.calls.map(([url, init]) => [(init as RequestInit).method, url]);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reading the caller’s bookings at an Event', () => {
  it('asks her own schedule, by the Event’s slug, with her cookies', async () => {
    fetchMock.mockResolvedValue(
      answer(200, {
        personId: 'lea-row',
        matches: [],
        refereeSlots: [],
        workshops: [
          { workshopId: 's-seat', status: 'confirmed' },
          { workshopId: 's-wait', status: 'waitlisted' },
        ],
        refusedWorkshopIds: ['s-refused'],
      }),
    );

    const bookings = await readBookings(API, 'fal 2027');

    expect([...(bookings ?? [])]).toEqual([
      ['s-seat', 'confirmed'],
      ['s-wait', 'waitlisted'],
      ['s-refused', 'refused'],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/api/v1/events/fal%202027/my-schedule`);
    expect(init.credentials).toBe('include');
  });

  it('reads a 401 as nobody: nothing is booked', async () => {
    fetchMock.mockResolvedValue(answer(401, { detail: 'Authentication required' }));

    const bookings = await readBookings(API, 'fal-2027');

    expect(bookings).not.toBeNull();
    expect(bookings?.size).toBe(0);
  });

  it.each([[404], [500]])(
    'answers null for a read that failed (%s): no verdict',
    async (status) => {
      fetchMock.mockResolvedValue(answer(status, { detail: 'no' }));

      await expect(readBookings(API, 'fal-2027')).resolves.toBeNull();
    },
  );

  it('answers null when the request never landed', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(readBookings(API, 'fal-2027')).resolves.toBeNull();
  });
});

describe('one tap on a session', () => {
  it.each<['confirmed' | 'waitlisted']>([['confirmed'], ['waitlisted']])(
    'books, and says what the server gave: %s',
    async (status) => {
      fetchMock.mockResolvedValue(answer(201, { id: 'e-1', status }));

      await expect(changeBooking(API, 's-1', 'book', 'none')).resolves.toEqual({
        ok: true,
        status,
      });
      expect(sent()).toEqual([['POST', `${API}/api/v1/workshop-sessions/s-1/enroll`]]);
    },
  );

  it('"Register again" is one call that removes the refusal first', async () => {
    fetchMock.mockResolvedValue(answer(201, { id: 'e-2', status: 'confirmed' }));

    await changeBooking(API, 's-1', 'book', 'refused');

    expect(sent()).toEqual([['POST', `${API}/api/v1/workshop-sessions/s-1/enroll?again=true`]]);
  });

  it.each<['confirmed' | 'waitlisted']>([['confirmed'], ['waitlisted']])(
    'gives up a booking (%s) with one DELETE, never with "again"',
    async (booking) => {
      fetchMock.mockResolvedValue(answer(204));

      await expect(changeBooking(API, 's-1', 'cancel', booking)).resolves.toEqual({
        ok: true,
        status: 'cancelled',
      });
      expect(sent()).toEqual([['DELETE', `${API}/api/v1/workshop-sessions/s-1/enroll`]]);
    },
  );

  it.each([
    ['nobody', 401, { code: 'UNAUTHORIZED', detail: 'Authentication required' }],
    ['teaches', 403, { code: 'INSTRUCTOR_SELF_ENROLLMENT', detail: 'You cannot register' }],
    ['removed', 403, { code: 'WORKSHOP_BOOKING_REFUSED', detail: 'You were removed' }],
    ['other', 403, { code: 'event_archived', detail: 'This event is archived' }],
    ['other', 404, { code: 'NOT_FOUND', detail: 'Session s-1 not found' }],
  ])('sorts a refusal as "%s" (%s)', async (why, status, body) => {
    fetchMock.mockResolvedValue(answer(status, body));

    const change = await changeBooking(API, 's-1', 'book', 'none');

    expect(change).toMatchObject({ ok: false, why, failure: { detail: body.detail } });
  });

  it('sorts a request that never landed as "other", with the failure the page words', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(changeBooking(API, 's-1', 'cancel', 'confirmed')).resolves.toEqual({
      ok: false,
      why: 'other',
      failure: { ok: false, kind: 'network' },
    });
  });
});

const source = (path: string) => readFileSync(resolve(__dirname, '../../..', path), 'utf8');

describe('the public Workshop page', () => {
  const page = source('app/e/[eventSlug]/w/[workshopSlug]/page.tsx');

  it('never looks for a login cookie: the server says who the caller is', () => {
    expect(page).not.toContain('document.cookie');
    expect(page).not.toContain('enrollmentStatus');
  });

  it('draws each session from the caller’s booking, with the one set of controls', () => {
    expect(page).toContain("const booking = bookings.get(session.id) ?? 'none';");
    expect(page).toMatch(
      /<WorkshopRegisterControls\s+booking=\{booking\}\s+full=\{isFull\}\s+busy=\{busy === session\.id\}\s+isInstructor=\{workshop\.viewerIsInstructor\}\s+labels=\{labels\}\s+onRegister=\{\(\) => void act\(session\.id, 'book', booking\)\}\s+onCancel=\{\(\) => void act\(session\.id, 'cancel', booking\)\}\s+\/>/,
    );
  });

  it('reads the Workshop and the bookings again after every tap, refused or not', () => {
    expect(page).toMatch(
      /const change = await changeBooking\(apiUrl, sessionId, action, booking\);\s+setBusy\(null\);\s+say\(changeNotice\(change, t\)\);\s+load\(\);/,
    );
    expect(page).toContain('}, [workshopSlug, eventSlug, apiUrl, loadKey]);');
    // A read that failed is no verdict: the page keeps the bookings it shows.
    expect(page).toMatch(
      /void readBookings\(apiUrl, eventSlug, signal\)\.then\(\(read\) => \{\s+if \(read\) setBookings\(read\);\s+\}\);/,
    );
  });

  it('lists no cancelled session: there is nothing to book', () => {
    expect(page).toContain(
      "const sessions = workshop.sessions.filter((session) => session.status !== 'cancelled');",
    );
    expect(page).toContain('{sessions.map((session) => {');
    expect(page).not.toContain('workshop.sessions.map(');
  });

  it('says each refusal in the reader’s language', () => {
    expect(page).toMatch(/nobody: t\('publicApp\.workshopDetail\.signInToEnroll'\)/);
    expect(page).toMatch(/teaches: t\('publicApp\.workshopDetail\.instructorCannotEnroll'\)/);
    expect(page).toMatch(/removed: t\('publicApp\.me\.workshops\.refused'\)/);
  });
});

describe('the instructor’s roster', () => {
  it('tags the person no account holds as a guest, beside the name (ruling 264)', () => {
    const dashboard = source('app/me/instructor/InstructorDashboard.tsx');
    expect(dashboard).toContain('<RosterName name={nameOf(r)} guest={r.guest} club={club} />');
    expect(dashboard).toMatch(
      /<span className="truncate">\{name\}<\/span>\s+\{guest && \(\s+<span[^>]*>\s+\{t\('publicApp\.me\.instructor\.guestTag'\)\}/,
    );
  });
});

describe('the personal Workshops page', () => {
  it('takes its words from the same owner as the public page', () => {
    const page = source('app/me/events/[eventSlug]/workshops/page.tsx');
    expect(page).toContain('const labels = registerLabels(t);');
    expect(page).not.toContain('function registerLabels');
    expect(source('src/components/me/WorkshopRegisterControls.tsx')).toContain(
      'export function registerLabels(',
    );
  });
});
