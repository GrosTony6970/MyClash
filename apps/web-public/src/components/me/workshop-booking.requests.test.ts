import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeSession } from '@myclash/api-client';
import { changeBooking, guestPersonAt, readBookings, unknownCaller } from './workshop-booking';

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

    const read = await readBookings(API, 'fal 2027');

    expect([...(read?.bookings ?? [])]).toEqual([
      ['s-seat', 'confirmed'],
      ['s-wait', 'waitlisted'],
      ['s-refused', 'refused'],
    ]);
    // The schedule itself comes too: the clash check reads her fights and duties (ruling 270).
    expect(read?.schedule).toMatchObject({ personId: 'lea-row', matches: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/api/v1/events/fal%202027/my-schedule`);
    expect(init.credentials).toBe('include');
  });

  it('reads a 401 as nobody: nothing is booked', async () => {
    fetchMock.mockResolvedValue(answer(401, { detail: 'Authentication required' }));

    const read = await readBookings(API, 'fal-2027');

    expect(read).toEqual({ bookings: new Map(), schedule: null });
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
    ['cancelled', 409, { code: 'WORKSHOP_SESSION_CANCELLED', detail: 'This workshop session' }],
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

describe('who the booking door did not know (ruling 266)', () => {
  const me = (body: unknown) => fetchMock.mockResolvedValue(answer(200, body));

  it('asks /me, with her cookies', async () => {
    me({ type: 'anonymous' });

    await unknownCaller(API);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/api/v1/me`);
    expect(init.credentials).toBe('include');
  });

  it('calls a signed-in account with no roster row an account: "sign in" would be false', async () => {
    me({ type: 'claimed', user: { id: 'u', email: 'marc@example.test' } });

    await expect(unknownCaller(API)).resolves.toBe('account');
  });

  it.each([
    ['nobody', { type: 'anonymous' }],
    ['a guest session of another Event', { type: 'guest' }],
  ])('calls %s a visitor', async (_who, body) => {
    me(body);

    await expect(unknownCaller(API)).resolves.toBe('visitor');
  });

  it('calls her a visitor when /me cannot be read: no proof of an account', async () => {
    fetchMock.mockResolvedValue(answer(500, { detail: 'no' }));
    await expect(unknownCaller(API)).resolves.toBe('visitor');

    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(unknownCaller(API)).resolves.toBe('visitor');
  });
});

describe('a guest at this Event (ruling 267)', () => {
  const lea = {
    id: 'lea-row',
    given_name: 'Léa',
    family_name: 'Martin',
    event_id: 'event-1',
    claim_status: 'unclaimed',
  };

  it('is the roster person of a guest session of this Event', () => {
    expect(guestPersonAt({ type: 'guest', person: lea }, 'event-1')).toBe('lea-row');
  });

  it.each<[string, MeSession | null, string | null]>([
    ['a guest session of another Event', { type: 'guest', person: lea }, 'event-2'],
    ['an account', { type: 'claimed', person: lea }, 'event-1'],
    ['nobody', { type: 'anonymous' }, 'event-1'],
    ['a guest session with no person', { type: 'guest' }, 'event-1'],
    ['a /me not read yet', null, 'event-1'],
    ['an Event not read yet', { type: 'guest', person: lea }, null],
  ])('is nobody for %s', (_who, session, eventId) => {
    expect(guestPersonAt(session, eventId)).toBeNull();
  });
});

const source = (path: string) => readFileSync(resolve(__dirname, '../../..', path), 'utf8');

describe('the public Workshop page', () => {
  const page = source('app/e/[eventSlug]/w/[workshopSlug]/page.tsx');
  const parts = source('app/e/[eventSlug]/w/[workshopSlug]/WorkshopPageParts.tsx');

  it('never looks for a login cookie: the server says who the caller is', () => {
    expect(page).not.toContain('document.cookie');
    expect(page).not.toContain('enrollmentStatus');
  });

  it('draws each session from the caller’s booking, with the one set of controls', () => {
    expect(page).toContain("const booking = caller.bookings.get(session.id) ?? 'none';");
    expect(page).toMatch(
      /<WorkshopRegisterControls\s+booking=\{booking\}\s+full=\{isFull\}\s+conflict=\{conflictFor\(session\)\}\s+busy=\{busy\.has\(session\.id\)\}\s+isInstructor=\{workshop\.viewerIsInstructor\}\s+labels=\{labels\}\s+onRegister=\{\(\) => void act\(session\.id, 'book', booking\)\}\s+onCancel=\{\(\) => void act\(session\.id, 'cancel', booking\)\}\s+\/>/,
    );
  });

  it('reads the Workshop and the bookings again after every tap, refused or not', () => {
    expect(page).toMatch(
      /const change = await changeBooking\(apiUrl, sessionId, action, booking\);\s+setBusy\(\(taps\) => tapEnded\(taps, sessionId\)\);\s+say\(changeNotice\(change, t\)\);\s+load\(\);/,
    );
    expect(page).toContain('}, [workshopSlug, eventSlug, apiUrl, loadKey]);');
  });

  it('keeps the bookings it shows when their read fails, and says so with a Retry (ruling 271)', () => {
    // An aborted read belongs to a screen that is gone: it is neither a verdict nor a failure.
    expect(page).toMatch(
      /void readBookings\(apiUrl, eventSlug, signal\)\.then\(\(read\) => \{\s+if \(signal\.aborted\) return;\s+if \(read\) setCaller\(read\);\s+setReadFailed\(read === null\);\s+\}\);/,
    );
    expect(page).toContain('{readFailed && <BookingsUnread onRetry={load} />}');
    expect(parts).toMatch(
      /\{t\('publicApp\.workshopDetail\.bookingsUnread'\)\}<\/p>\s+<Button variant="secondary" size="sm" onClick=\{onRetry\}>\s+\{t\('actions\.retry'\)\}/,
    );
  });

  it('tells a caller the door did not know the ways in, after the tap, and until a tap is accepted (ruling 266)', () => {
    expect(page).toMatch(
      /const stranger = !change\.ok && change\.why === 'nobody';\s+const who = stranger \? await unknownCaller\(apiUrl\) : null;/,
    );
    // Two taps close together: only the last tap's answer is shown.
    expect(page).toMatch(
      /const tap = \+\+taps\.current;\s+setBusy\(\(taps\) => tapStarted\(taps, sessionId\)\);/,
    );
    expect(page).toContain('if (taps.current === tap) setUnknown(who);');
    expect(page).toContain(
      '{unknown && <UnknownCallerNotice who={unknown} eventSlug={eventSlug} />}',
    );
    // No 3-second message for her: the notice stays.
    expect(page).toContain("return change.why === 'nobody' ? null : refusalWords(change, t);");
    // An account reads its own sentence, and is not told to sign in.
    const [, account, visitor] = parts.split(/if \(who === 'account'\) \{|\n {2}\}\n {2}return \(/);
    expect(account).toContain("{t('publicApp.workshopDetail.accountNotOnRoster')}");
    expect(account).not.toContain('/login');
    expect(visitor).toContain("{t('publicApp.workshopDetail.findYourName')}");
    expect(visitor).toMatch(
      /<Link href=\{`\/e\/\$\{eventSlug\}\/participants`\} className=\{DOOR\}>\s+\{t\('publicApp\.workshopDetail\.participantsList'\)\}/,
    );
    expect(visitor).toMatch(
      /<Link href="\/login" className=\{DOOR\}>\s+\{t\('publicApp\.home\.signIn'\)\}/,
    );
  });

  it('tells a guest of this Event that a guest gets no alert, with the way to an account (ruling 267)', () => {
    expect(page).toContain('const guestPersonId = guestPersonAt(me, eventInfo?.id ?? null);');
    expect(page).toContain(
      '{guestPersonId && <GuestAlertsLine eventSlug={eventSlug} personId={guestPersonId} />}',
    );
    // A /me that failed shows no line: it is not a guest.
    expect(page).toMatch(
      /void fetchMe\(apiUrl, \{ signal: controller\.signal \}\)\.then\(\(result\) => \{\s+if \(result\.ok\) setMe\(result\.data\);/,
    );
    expect(parts).toMatch(
      /\{t\('publicApp\.workshopDetail\.guestNoAlerts'\)\}\{' '\}\s+<Link\s+href=\{`\/e\/\$\{eventSlug\}\/claim\?personId=\$\{personId\}&next=\$\{back\}`\}/,
    );
  });

  it('lists no cancelled session: there is nothing to book', () => {
    expect(page).toContain(
      "const sessions = workshop.sessions.filter((session) => session.status !== 'cancelled');",
    );
    expect(page).toContain('{sessions.map((session) => {');
    expect(page).not.toContain('workshop.sessions.map(');
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
