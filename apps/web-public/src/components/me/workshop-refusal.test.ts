import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeBooking, refusalWords, type BookingChange } from './workshop-booking';

/**
 * The personal Workshops page says a refused tap (operator ruling 294).
 *
 * Lea is signed in. She taps Register on a session the organiser cancelled a minute ago. The
 * page sent a raw `fetch` and never read the answer: the spinner stopped and the card looked the
 * same. It now sends the tap through `changeBooking`, as the public Workshop page does, and says
 * the refusal in a line under that session's button, until her next tap.
 *
 * Both pages take the sentence from ONE owner, `refusalWords`. This package's vitest does not
 * compile TSX: the owner is driven here, and the pages are read as text for the wiring.
 */

const API = 'https://api.example.test';
const fetchMock = vi.fn();
const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });
// The key itself: a test reads which sentence was picked, not its translation.
const t = (key: string) => key;

async function refusedTap(status: number, body: unknown) {
  fetchMock.mockResolvedValue(answer(status, body));
  const change = await changeBooking(API, 's-1', 'book', 'none');
  if (change.ok) throw new Error('the tap was accepted');
  return change;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the sentence of a refused tap', () => {
  it.each([
    [
      'she teaches this Workshop',
      403,
      { code: 'INSTRUCTOR_SELF_ENROLLMENT', detail: 'You cannot register' },
      'publicApp.workshopDetail.instructorCannotEnroll',
    ],
    [
      'the instructor removed her',
      403,
      { code: 'WORKSHOP_BOOKING_REFUSED', detail: 'You were removed' },
      'publicApp.me.workshops.refused',
    ],
    [
      'the session was cancelled',
      409,
      { code: 'WORKSHOP_SESSION_CANCELLED', detail: 'This workshop session is cancelled' },
      'publicApp.workshopDetail.sessionCancelled',
    ],
    [
      'the Event is archived',
      403,
      { code: 'event_archived', detail: 'This event is archived' },
      'common.apiFailure.eventArchived',
    ],
    [
      'her login is gone',
      401,
      { code: 'UNAUTHORIZED', detail: 'Authentication required' },
      'common.apiFailure.unauthenticated',
    ],
  ])('%s', async (_story, status, body, key) => {
    expect(refusalWords(await refusedTap(status, body), t)).toBe(key);
  });

  it('says the server’s own reason when the page has no sentence for it', async () => {
    const change = await refusedTap(404, { code: 'NOT_FOUND', detail: 'Session s-1 not found' });

    expect(refusalWords(change, t)).toBe('Session s-1 not found');
  });

  it('says the request never landed', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const change = (await changeBooking(API, 's-1', 'cancel', 'confirmed')) as Extract<
      BookingChange,
      { ok: false }
    >;

    expect(refusalWords(change, t)).toBe('common.apiFailure.network');
  });
});

describe('a tap the server accepted with no body', () => {
  it('is a booking, and never a throw out of the page’s tap handler', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(changeBooking(API, 's-1', 'book', 'none')).resolves.toEqual({
      ok: true,
      status: 'confirmed',
    });
  });
});

const source = (path: string) => readFileSync(resolve(__dirname, '../../..', path), 'utf8');

describe('the personal Workshops page', () => {
  const page = source('app/me/events/[eventSlug]/workshops/page.tsx');

  it('sends one tap as one call, through the owner that reads the answer', () => {
    expect(page.match(/await changeBooking\(api, sessionId, action, booking\)/g)).toHaveLength(1);
    expect(page).not.toContain('enrollPath');
    expect(page).toContain("onRegister={() => void act(session.id, 'book', booking)}");
    expect(page).toContain("onCancel={() => void act(session.id, 'cancel')}");
  });

  it('keeps the refusal of the last refused tap, with its session', () => {
    expect(page).toMatch(
      /const words = change\.ok \? null : refusalWords\(change, t\);\s+if \(words\) setRefused\(\{ sessionId, words \}\);/,
    );
  });

  it('takes the line away at the next tap, never at an answer', () => {
    expect(page).toMatch(
      /setBusy\(\(taps\) => tapStarted\(taps, sessionId\)\);\s+setRefused\(null\);/,
    );
    expect(page.match(/setRefused\(null\)/g)).toHaveLength(1);
  });

  it('says it under the button of the session that was tapped', () => {
    expect(page).toMatch(
      /const refusedLine = refused && \(\s+<p role="alert" className="text-xs font-semibold text-danger">\s+\{refused\.words\}\s+<\/p>\s+\);/,
    );
    expect(page).toMatch(
      /onCancel=\{\(\) => void act\(session\.id, 'cancel'\)\}\s+\/>\s+\{refused\?\.sessionId === session\.id && refusedLine\}/,
    );
  });

  // The cancelled-session refusal: the read after the tap drops that session, and its card
  // goes or shows another session. The line must not go with it.
  it('says it above the list when the tapped session has left the list', () => {
    expect(page).toContain(
      "const shown = visible.map((w) => w.sessions.find((s) => s.status !== 'cancelled')?.id);",
    );
    expect(page).toContain(
      'const cardGone = refused !== null && !shown.includes(refused.sessionId);',
    );
    expect(page).toMatch(
      /<div className="flex flex-col gap-6">\s+\{cardGone && refusedLine\}\s+<ClashCheckNotice/,
    );
  });

  it('says it above "no Workshop" when the last card left with it', () => {
    expect(page).toMatch(
      /if \(visible\.length === 0\) \{\s+return \(\s+<div className="flex flex-col gap-6">\s+\{refusedLine\}\s+<EmptyState title=\{t\('publicApp\.me\.workshops\.empty'\)\} \/>/,
    );
  });

  it('reads the Workshops and her schedule again after every tap, refused or not', () => {
    expect(page).toMatch(
      /if \(words\) setRefused\(\{ sessionId, words \}\);\s+setWsKey\(\(k\) => k \+ 1\);\s+refreshSchedule\(\);/,
    );
  });
});

describe('the public Workshop page', () => {
  const page = source('app/e/[eventSlug]/w/[workshopSlug]/page.tsx');

  it('takes a refusal’s sentence from the same owner', () => {
    expect(page).toContain("return change.why === 'nobody' ? null : refusalWords(change, t);");
    expect(page).not.toContain('instructorCannotEnroll');
    expect(page).not.toContain('sessionCancelled');
  });
});
