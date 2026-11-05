import type { Page, Request, Route } from '@playwright/test';
import { stubPublicApi, waitForPageMain } from './helpers';
import { PUBLIC } from './public-pages-stub';

/**
 * The browser side of an Event's public photos page (`photos-public.spec.ts`,
 * `photos-public-report.spec.ts`): the photo list, the Report and the pictures, answered per
 * test. The Event and its Tournament come from `scripts/e2e-server-api-stub.mjs`.
 */

const PAGE = `${PUBLIC}/e/photo-event/photos`;
const LIST = '**/api/v1/events/ev-photo/photos/public*';
const REPORT = '**/api/v1/events/ev-photo/photos/*/report';
export const TOURNAMENT = 'ev-photo-t1';

// 2026-03-14 is a Saturday; 10:00 UTC is 11:00 in Paris, the Event's clock.
const BASE = Date.parse('2026-03-14T10:00:00.000Z');

/** Photo `i` is `i` minutes older than photo 0, its time as the server writes it. */
export function photo(i: number, over: object = {}) {
  const id = `p${i}`;
  return {
    id,
    uploaderName: null,
    caption: null,
    tag: null,
    createdAt: new Date(BASE - i * 60_000).toISOString().replace('Z', '+00:00'),
    previewUrl: `https://bucket.test/${id}/preview.jpg`,
    originalUrl: `https://bucket.test/${id}/original.jpg`,
    ...over,
  };
}
export const range = (from: number, to: number, over: object = {}) =>
  Array.from({ length: to - from + 1 }, (_, k) => photo(from + k, over));
export const pageOf = (photos: ReturnType<typeof photo>[]) => ({
  photos,
  next: photos.length === 30 ? photos[photos.length - 1]!.createdAt : null,
});

// A 1×1 transparent PNG: every picture loads, so no console error is logged.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

type Answer = (route: Route, request: Request) => Promise<void> | void;

/** The page with its list answered by `answer` (each GET's URL kept), its pictures loading. */
export async function openPhotos(page: Page, answer: Answer, url = PAGE) {
  const reads: URL[] = [];
  await stubPublicApi(page);
  await page.route('https://bucket.test/**', (route) =>
    route.fulfill({ body: PIXEL, contentType: 'image/png' }),
  );
  await page.route(LIST, (route, request) => {
    reads.push(new URL(request.url()));
    return answer(route, request);
  });
  await page.goto(url);
  await waitForPageMain(page);
  return reads;
}

export const answerWith =
  (body: object, status = 200): Answer =>
  (route) =>
    route.fulfill({ status, json: body });

/** Every Report POST, answered in turn by `answers`. */
export async function reportsTo(page: Page, answers: Answer[]) {
  const posts: Request[] = [];
  await page.route(REPORT, async (route, request) => {
    posts.push(request);
    const next = answers.shift();
    if (next) await next(route, request);
  });
  return posts;
}

export const tiles = (page: Page) => page.getByRole('main').getByRole('listitem');
export const tileOf = (page: Page, caption: string) =>
  tiles(page).filter({ has: page.getByRole('img', { name: caption }) });
export const dialog = (page: Page) => page.getByRole('dialog', { name: 'Report this photo?' });
