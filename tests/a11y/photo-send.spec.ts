import { expect, test, type Page, type Request, type Route } from '@playwright/test';
import {
  collectPageIssues,
  expectNoCriticalAxeViolations,
  expectNoPageIssues,
  stubPublicApi,
} from './helpers';
import { CAMERA_JPEG, markerCount, PROGRESSIVE_JPEG, uploadedFile } from './photo-jpegs';
import { PUBLIC } from './public-pages-stub';

/**
 * The page an Event's photo QR code opens (design, "The uploader"; slice 2b). The Event and its
 * Tournament come from `scripts/e2e-server-api-stub.mjs` (`photo-event`, `photo-off-event`); the
 * upload itself is stubbed here, per test.
 */

test.use({ viewport: { width: 390, height: 844 } });

const TOKEN = 'tok-123';
const PAGE = `${PUBLIC}/e/photo-event/photos/send`;

// A real camera-shaped JPEG: the phone sends it as it is. The API is stubbed.
const JPEG = CAMERA_JPEG;
const HEIC = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypheic', 'ascii'),
  Buffer.alloc(64),
]);

type Answer = (route: Route) => Promise<void>;
const answer =
  (status: number, json: object): Answer =>
  (route) =>
    route.fulfill({ status, json });

/** Every request the page makes, and the photo POSTs answered in turn by `answers`. */
async function openPage(page: Page, url: string, answers: Answer[] = []) {
  const requested: string[] = [];
  const posts: Request[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await stubPublicApi(page);
  await page.route('**/api/v1/events/ev-photo/photos', async (route) => {
    posts.push(route.request());
    const next = answers.shift();
    if (next) await next(route);
    else await route.abort('connectionrefused');
  });
  await page.goto(url);
  return { requested, posts };
}

const pick = (page: Page, name: string, buffer: Buffer) =>
  page.getByTestId('photo-picker').setInputFiles({ name, mimeType: 'image/jpeg', buffer });
const rows = (page: Page) => page.getByTestId('photo-row');
const send = (page: Page) => page.getByRole('button', { name: 'Send', exact: true });

/**
 * Before React runs, nothing on the page may act: no `<form>` the browser could submit by itself
 * (Enter in a field would reload the page without its `#token`), and the picker gated on the
 * token, which the server cannot see.
 */
test('the server sends the page with nothing that can send', async ({ page }) => {
  const html = await (await page.request.get(PAGE)).text();
  // The page streams: a loading `<main>` comes first, the page's own later in the same HTML.
  const label = html.indexOf('Choose photos');
  expect(label).toBeGreaterThan(-1);
  const main = html.slice(html.lastIndexOf('<main', label), html.indexOf('</main>', label));
  expect(main).not.toContain('<form');
  const buttons = main.match(/<button[^>]*>/g) ?? [];
  // Take a photo, Choose photos, Send.
  expect(buttons).toHaveLength(3);
  for (const button of buttons) expect(button).toMatch(/\sdisabled=""/);
});

test('an Event that takes no photos says so, and offers the Event instead', async ({ page }) => {
  const issues = collectPageIssues(page);
  await openPage(page, `${PUBLIC}/e/photo-off-event/photos/send#${TOKEN}`);

  await expect(page.getByRole('status')).toContainText('This Event does not take photos.');
  await expect(page.getByRole('link', { name: 'See the Event' })).toHaveAttribute(
    'href',
    '/e/photo-off-event/home',
  );
  await expect(page.getByTestId('photo-picker')).toHaveCount(0);
  await expectNoCriticalAxeViolations(page);
  await expectNoPageIssues(issues);
});

test('a link without its token says to scan the code again', async ({ page }) => {
  await openPage(page, PAGE);
  await expect(page.getByRole('status')).toContainText(
    'This link is not complete. Scan the QR code again.',
  );
});

test('a photo goes with its name and Tournament, and waits for approval', async ({ page }) => {
  const issues = collectPageIssues(page);
  const { requested, posts } = await openPage(page, `${PAGE}#${TOKEN}`, [
    answer(201, { id: 'p1', status: 'waiting' }),
  ]);

  await pick(page, 'a.jpg', JPEG);
  await page.getByLabel('Your name').fill('Ada');
  await page.getByLabel('Tournament or Workshop').selectOption({ label: 'Longsword Open' });
  await send(page).click();

  await expect(rows(page)).toContainText('Sent. It will show once an organiser approves it.');
  expect(posts).toHaveLength(1);
  expect(posts[0]!.headers()['x-photo-token']).toBe(TOKEN);
  const body = posts[0]!.postDataBuffer()!.toString('latin1');
  expect(body).toMatch(/name="name"\r\n\r\nAda\r\n/);
  expect(body).toMatch(/name="tournamentId"\r\n\r\nev-photo-t1\r\n/);
  expect(body).toContain('filename="a.jpg"');
  expect(requested.filter((url) => url.includes(TOKEN))).toEqual([]);
  await expectNoCriticalAxeViolations(page);
  await expectNoPageIssues(issues);
});

// A new tab, so the photos already picked stay on this one (ruling 475).
test('the notice links to the photo section of the privacy policy, in a new tab', async ({
  page,
}) => {
  await openPage(page, `${PAGE}#${TOKEN}`);
  const link = page.getByRole('link', { name: 'How MyClash handles photos' });
  await expect(link).toHaveAttribute('href', /\/en\/privacypolicy#photos$/);
  await expect(link).toHaveAttribute('target', '_blank');
});

/**
 * Android's photo picker has no camera, so a phone gets its own camera button. A computer ignores
 * `capture` and would open the same file dialog twice: it shows only "Choose photos".
 */
test.describe('the camera button', () => {
  test('a computer shows only Choose photos', async ({ page }) => {
    await openPage(page, `${PAGE}#${TOKEN}`);
    await expect(page.getByRole('button', { name: 'Choose photos' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Take a photo' })).toBeHidden();
  });

  test.describe('on a phone', () => {
    test.use({ isMobile: true, hasTouch: true });

    test('Take a photo opens the camera, and its shot is queued and sent', async ({ page }) => {
      const issues = collectPageIssues(page);
      const { posts } = await openPage(page, `${PAGE}#${TOKEN}`, [
        answer(201, { id: 'p1', status: 'approved' }),
      ]);
      await expect(page.getByRole('button', { name: 'Take a photo' })).toBeEnabled();
      const camera = page.getByTestId('photo-camera');
      await expect(camera).toHaveAttribute('capture', 'environment');
      await expect(camera).not.toHaveAttribute('multiple');

      await camera.setInputFiles({ name: 'shot.jpg', mimeType: 'image/jpeg', buffer: JPEG });
      await send(page).click();
      await expect(rows(page)).toContainText('Sent.');
      expect(posts).toHaveLength(1);
      expect(posts[0]!.postDataBuffer()!.toString('latin1')).toContain('filename="shot.jpg"');
      await expectNoCriticalAxeViolations(page);
      await expectNoPageIssues(issues);
    });
  });
});

/**
 * The API keeps only the JPEG shape a camera writes (ruling 1004). A camera JPEG goes byte for
 * byte; a progressive one (a website's, a Google Photos cloud copy) is drawn again on the phone
 * as one baseline scan, under its own name.
 */
test.describe('the camera shape', () => {
  test('a camera JPEG is sent byte for byte', async ({ page }) => {
    const { posts } = await openPage(page, `${PAGE}#${TOKEN}`, [
      answer(201, { id: 'p1', status: 'approved' }),
    ]);
    await pick(page, 'a.jpg', CAMERA_JPEG);
    await send(page).click();
    await expect(rows(page)).toContainText('Sent.');
    const file = uploadedFile(posts[0]!.postDataBuffer()!, 'a.jpg');
    expect(file.equals(CAMERA_JPEG)).toBe(true);
  });

  test('a progressive JPEG is sent as one baseline scan', async ({ page }) => {
    const issues = collectPageIssues(page);
    const { posts } = await openPage(page, `${PAGE}#${TOKEN}`, [
      answer(201, { id: 'p1', status: 'approved' }),
    ]);
    await pick(page, 'm-magazine-1.jfif', PROGRESSIVE_JPEG);
    await send(page).click();
    await expect(rows(page)).toContainText('Sent.');

    expect(posts).toHaveLength(1);
    const file = uploadedFile(posts[0]!.postDataBuffer()!, 'm-magazine-1.jfif');
    expect([...file.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    expect(markerCount(file, 0xc2)).toBe(0);
    expect(markerCount(file, 0xc0)).toBe(1);
    expect(markerCount(file, 0xda)).toBe(1);
    await expectNoPageIssues(issues);
  });

  test('a JPEG the phone cannot decode is refused before a byte is sent', async ({ page }) => {
    const { posts } = await openPage(page, `${PAGE}#${TOKEN}`);
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
    await pick(page, 'broken.jpg', broken);
    await send(page).click();
    await expect(rows(page).getByRole('alert')).toContainText('This photo could not be read.');
    await expect(rows(page).getByRole('button', { name: 'Retry' })).toHaveCount(0);
    expect(posts).toHaveLength(0);
  });
});

test('a busy answer is sent again on its own', async ({ page }) => {
  const { posts } = await openPage(page, `${PAGE}#${TOKEN}`, [
    answer(503, { code: 'photos_busy', detail: 'Many photos are arriving at once.' }),
    answer(201, { id: 'p1', status: 'approved' }),
  ]);

  await pick(page, 'a.jpg', JPEG);
  await send(page).click();

  await expect(rows(page)).toContainText('Many photos are arriving at once. Trying again…');
  await expect(rows(page)).toContainText('Sent.', { timeout: 10_000 });
  expect(posts).toHaveLength(2);
});

test('a HEIC photo is refused before a byte is sent', async ({ page }) => {
  const { posts } = await openPage(page, `${PAGE}#${TOKEN}`, [
    answer(201, { id: 'p1', status: 'approved' }),
  ]);

  // Named .jpg: the bytes decide, not the name.
  await pick(page, 'b.jpg', HEIC);
  await expect(rows(page).getByRole('alert')).toContainText('This photo is in HEIC format.');
  await expect(rows(page).getByRole('button', { name: 'Retry' })).toHaveCount(0);

  await pick(page, 'a.jpg', JPEG);
  await send(page).click();
  await expect(rows(page).nth(1)).toContainText('Sent.');
  // One known call ends the test: a stray POST of the HEIC would be in this list too.
  expect(posts).toHaveLength(1);
  expect(posts[0]!.postDataBuffer()!.toString('latin1')).toContain('filename="a.jpg"');
});

test('a closed window closes the form, and the next photo is not sent', async ({ page }) => {
  const { posts } = await openPage(page, `${PAGE}#${TOKEN}`, [
    answer(403, { code: 'photos_window_closed', detail: 'Photos are not open for this Event.' }),
  ]);

  await page.getByTestId('photo-picker').setInputFiles([
    { name: 'a.jpg', mimeType: 'image/jpeg', buffer: JPEG },
    { name: 'b.jpg', mimeType: 'image/jpeg', buffer: JPEG },
  ]);
  await send(page).click();

  await expect(page.getByRole('status')).toContainText(
    'Photos are not open for this Event right now.',
  );
  await expect(page.getByRole('link', { name: 'See the Event' })).toBeVisible();
  await expect(send(page)).toHaveCount(0);
  // The second photo is still waiting: not sent, not failed, and no Retry is offered anywhere.
  await expect(rows(page).nth(1).getByRole('button', { name: 'Remove' })).toBeVisible();
  await expect(rows(page).nth(1).getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  expect(posts).toHaveLength(1);
});

test('a lost connection keeps the photo, and Retry sends it', async ({ page }) => {
  const { posts } = await openPage(page, `${PAGE}#${TOKEN}`, [
    (route) => route.abort('connectionreset'),
    answer(201, { id: 'p1', status: 'approved' }),
  ]);

  await pick(page, 'a.jpg', JPEG);
  await send(page).click();
  await expect(rows(page).getByRole('alert')).toHaveText(
    'Could not reach the server. Check your connection and try again.',
  );

  await rows(page).getByRole('button', { name: 'Retry' }).click();
  await expect(rows(page)).toContainText('Sent.');
  expect(posts).toHaveLength(2);
});
