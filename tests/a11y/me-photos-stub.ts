import type { Page, Request, Route } from '@playwright/test';
import { LEA, PUBLIC, signInAsLea } from './me-stub';

/**
 * Léa's Photos tab in her personal space (slice 6b; `me-photos.spec.ts`,
 * `me-photos-failures.spec.ts`). Her Event is the stub's `photo-event` (`ev-photo`,
 * `scripts/e2e-server-api-stub.mjs`): the page reads it and its Tournament ON THE SERVER, where
 * `page.route` sees nothing, so "my events" names that slug and id. The browser's reads are
 * answered here, per test.
 */

export const TAB = `${PUBLIC}/me/events/photo-event/photos`;
const MY_EVENTS = '**/api/v1/me/events';
const MY_PHOTOS = '**/api/v1/me/events/ev-photo/photos*';
const ONE_PHOTO = '**/api/v1/me/events/ev-photo/photos/*';

/** Her Event as `GET me/events` lists it, with its photo mode and whether she has photos there. */
export function myEvent(photoMode: string | null, hasMyPhotos = false) {
  return {
    event: {
      id: 'ev-photo',
      slug: 'photo-event',
      name: 'Open de Lyon',
      startDate: '2026-03-14',
      endDate: '2026-03-15',
      status: 'running',
      timezone: 'Europe/Paris',
      kind: 'standard',
      photoMode,
    },
    roles: {
      isCompetitor: true,
      isReferee: false,
      isWorkshopParticipant: false,
      isInstructor: false,
    },
    tournaments: [],
    refereeOf: [],
    workshopsTeaching: [],
    counts: { matches: 0, refereeSlots: 0, workshops: 0 },
    hasMyPhotos,
  };
}

// 2026-03-14 is a Saturday; 10:00 UTC is 11:00 in Paris, the Event's clock.
const BASE = Date.parse('2026-03-14T10:00:00.000Z');

/** Her photo `i`, `i` minutes older than photo 0, its time as the server writes it. */
export function myPhoto(i: number, over: object = {}) {
  const id = `p${i}`;
  return {
    id,
    status: 'approved',
    caption: `Photo ${i}`,
    tag: null,
    createdAt: new Date(BASE - i * 60_000).toISOString().replace('Z', '+00:00'),
    previewUrl: `https://bucket.test/${id}/preview.jpg`,
    originalUrl: `https://bucket.test/${id}/original.jpg`,
    ...over,
  };
}
export const myRange = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, k) => myPhoto(from + k));

/** A page of hers as the server answers it: `next` set when it is full. */
export function minePage(photos: ReturnType<typeof myPhoto>[], over: object = {}) {
  return {
    posterName: 'Léa Martin',
    sendOpen: true,
    photos,
    next: photos.length === 30 ? photos[photos.length - 1]!.createdAt : null,
    ...over,
  };
}

// A 1×1 transparent PNG: every picture loads, so no console error is logged.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

// Only the first bytes matter to the page; the API is stubbed.
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

export type Answer = (route: Route, request: Request) => Promise<void> | void;
export const json =
  (body: unknown, status = 200): Answer =>
  (route) =>
    route.fulfill({ status, json: body });

/**
 * Each answer is chosen by what has happened, never by the order of the reads: `next dev` runs
 * every effect twice (Strict Mode), so a page reads "my events" and her list twice on its own.
 */
interface Tab {
  /** "My events": every read. Default: her Event, photos Approve first. */
  events?: Answer;
  /** Her photo list: every GET (the test reads the request's `before`, or its own state). */
  list?: Answer;
  /** Each photo POST answered by the next answer; none left: the connection is refused. */
  sends?: Answer[];
  /**
   * Her login is over an hour old: "my events" (or her first send) answers 401 until the page
   * asks `/api/v1/me` AFTER that 401, which renews it.
   */
  lapsed?: 'events' | 'send';
  url?: string;
}

/** The renewal of a lapsed login: `/me` counts only when it comes after a refused request. */
async function lapsedLogin(page: Page) {
  const login = { refused: false, renewed: false };
  await page.route('**/api/v1/me', (route) => {
    if (login.refused) login.renewed = true;
    return route.fulfill({ json: { type: 'claimed', user: LEA } });
  });
  /** Answers 401 while the login is not renewed; else `then`. */
  return (then: Answer): Answer =>
    (route, request) => {
      if (login.renewed) return then(route, request);
      login.refused = true;
      return route.fulfill({ status: 401, json: { statusCode: 401 } });
    };
}

/** Léa signed in, her tab's reads answered, every request to her photos recorded. */
export async function openTab(page: Page, tab: Tab = {}) {
  const reads: URL[] = [];
  const posts: Request[] = [];
  const deletes: Request[] = [];
  const sends = [...(tab.sends ?? [])];
  await signInAsLea(page);
  const unlessLapsed = await lapsedLogin(page);
  await page.route('https://bucket.test/**', (route) =>
    route.fulfill({ body: PIXEL, contentType: 'image/png' }),
  );
  const events = tab.events ?? json([myEvent('approve')]);
  await page.route(MY_EVENTS, tab.lapsed === 'events' ? unlessLapsed(events) : events);
  const list = tab.list ?? json(minePage([]));
  const send: Answer = (route, request) => {
    const next = sends.shift();
    return next ? next(route, request) : route.abort('connectionrefused');
  };
  const sendOnce = tab.lapsed === 'send' ? unlessLapsed(send) : send;
  await page.route(MY_PHOTOS, async (route, request) => {
    if (request.method() === 'GET') {
      reads.push(new URL(request.url()));
      return list(route, request);
    }
    posts.push(request);
    return sendOnce(route, request);
  });
  await page.route(ONE_PHOTO, (route, request) => {
    deletes.push(request);
    return route.fulfill({ status: 204 });
  });
  await page.goto(tab.url ?? TAB);
  return { reads, posts, deletes };
}

export const pick = (page: Page) =>
  page
    .getByTestId('photo-picker')
    .setInputFiles({ name: 'a.jpg', mimeType: 'image/jpeg', buffer: JPEG });
export const sendButton = (page: Page) => page.getByRole('button', { name: 'Send', exact: true });
export const pickButton = (page: Page) =>
  page.getByRole('button', { name: 'Take or choose photos' });
export const myTiles = (page: Page) => page.getByTestId('my-photo');
export const tabStrip = (page: Page) => page.getByRole('main').getByRole('tablist');
