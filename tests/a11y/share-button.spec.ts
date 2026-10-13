/**
 * Share sends a page's link (quick win F19; operator rulings 2026-10-13 and
 * 2026-10-14): the browser's share sheet where there is one; else the link is
 * copied and the button says so; a copy that fails says so. No Share on a page
 * the public cannot open.
 *
 * Only a fighter's profile had a button, it only copied, and it said nothing
 * when the copy failed. A bout's address in the bar carries `?return=…`, the
 * sender's way back: Share sends the plain address.
 *
 * The sheet itself is the phone's. A story records the call the page makes.
 * The pages read on the SERVER: `scripts/e2e-server-api-stub.mjs` answers them.
 */
import { test, expect, type Page } from '@playwright/test';
import { expectNoCriticalAxeViolations, stubPublicApi } from './helpers';
import { PUBLIC } from './public-pages-stub';

const BOUT = `${PUBLIC}/e/test-event/match/bout-1`;
const TOURNAMENT = `${PUBLIC}/e/test-event/t/longsword-open`;

type Sheet = 'opens' | 'stays open' | 'closed by the person' | 'none';
type Clipboard = 'takes' | 'refuses';

interface Doors {
  shared: Array<{ title: string; url: string }>;
  copied: string[];
}

/** Put a recorded share sheet and a recorded clipboard in the page, before it loads. */
async function browserWith(page: Page, sheet: Sheet, clipboard: Clipboard = 'takes') {
  await page.addInitScript(
    ([sheetIs, clipboardIs]) => {
      const doors: Doors = { shared: [], copied: [] };
      (window as unknown as { doors: Doors }).doors = doors;
      const share = (data: { title: string; url: string }) => {
        doors.shared.push(data);
        // A real sheet answers when the person is done with it. A second call
        // meanwhile is refused, and not as "closed by the person".
        if (sheetIs === 'stays open') {
          return doors.shared.length === 1
            ? new Promise<void>(() => {})
            : Promise.reject(new DOMException('a share is under way', 'InvalidStateError'));
        }
        return sheetIs === 'opens'
          ? Promise.resolve()
          : Promise.reject(new DOMException('closed', 'AbortError'));
      };
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: sheetIs === 'none' ? undefined : share,
      });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text: string) => {
            doors.copied.push(text);
            return clipboardIs === 'takes'
              ? Promise.resolve()
              : Promise.reject(new Error('refused'));
          },
        },
      });
    },
    [sheet, clipboard] as const,
  );
}

const doorsOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { doors: Doors }).doors) as Promise<Doors>;

const shareButton = (page: Page) => page.getByTestId('share-button');
const said = (page: Page) => page.getByTestId('share-status');

async function open(page: Page, address: string) {
  await stubPublicApi(page);
  await page.goto(address);
}

/**
 * Tap Share until the page answers the tap: a tap before the page is live does
 * nothing, and then no door is called.
 */
async function tapShare(page: Page) {
  await expect(async () => {
    await shareButton(page).click();
    const doors = await doorsOf(page);
    expect(doors.shared.length + doors.copied.length).toBeGreaterThan(0);
  }).toPass({ timeout: 15_000 });
}

test('on a phone, Share opens the share sheet with the plain address of the bout', async ({
  page,
}) => {
  await browserWith(page, 'opens');
  // The address in the bar holds the sender's way back.
  await open(page, `${BOUT}?return=%2Fe%2Ftest-event%2Fmy-schedule`);

  await tapShare(page);

  const doors = await doorsOf(page);
  // One call, and only one.
  expect(doors.shared).toEqual([{ title: 'Jean Dupont vs Paul Martin · Open de Lyon', url: BOUT }]);
  expect(doors.copied).toEqual([]);
  await expect(shareButton(page)).toHaveText('Share');
  await expect(said(page)).toHaveText('');
});

test('a sheet the person closes says nothing and copies nothing', async ({ page }) => {
  await browserWith(page, 'closed by the person');
  await open(page, BOUT);

  await tapShare(page);

  expect((await doorsOf(page)).copied).toEqual([]);
  await expect(shareButton(page)).toHaveText('Share');
  await expect(said(page)).toHaveText('');
});

test('a second tap while the sheet is open does nothing', async ({ page }) => {
  await browserWith(page, 'stays open');
  await open(page, BOUT);

  await tapShare(page);
  await shareButton(page).click();
  await shareButton(page).click();

  // The browser refuses a second sheet. Passed on, that refusal copied the link
  // and said "Copied!" under the open sheet.
  const doors = await doorsOf(page);
  expect(doors.shared).toHaveLength(1);
  expect(doors.copied).toEqual([]);
  await expect(shareButton(page)).toHaveText('Share');
});

test('with no share sheet, Share copies the link and says "Copied!" for two seconds', async ({
  page,
}) => {
  await browserWith(page, 'none');
  await open(page, `${BOUT}?return=%2Fe%2Ftest-event%2Fmy-schedule`);

  await tapShare(page);

  expect((await doorsOf(page)).copied).toEqual([BOUT]);
  await expect(shareButton(page)).toHaveText('Copied!');
  // A screen reader hears it: the same words in a polite live region.
  await expect(said(page)).toHaveText('Copied!');
  await expect(said(page)).toHaveAttribute('role', 'status');
  await expect(shareButton(page)).toHaveText('Share', { timeout: 5_000 });
  await expect(said(page)).toHaveText('');

  // The tap that ended does not hold the next one back.
  await shareButton(page).click();
  await expect(shareButton(page)).toHaveText('Copied!');
  expect((await doorsOf(page)).copied).toEqual([BOUT, BOUT]);
});

test('a copy the browser refuses says so, for longer than "Copied!"', async ({ page }) => {
  await browserWith(page, 'none', 'refuses');
  await open(page, BOUT);

  await tapShare(page);

  await expect(shareButton(page)).toHaveText('Could not copy the link');
  await expect(said(page)).toHaveText('Could not copy the link');
  // Not for two seconds only: the link is not on the clipboard, and the person must know.
  await page.waitForTimeout(3_000);
  await expect(shareButton(page)).toHaveText('Could not copy the link');
  // Then the button is "Share" again: a screen reader that lands on it later reads what it does.
  await expect(shareButton(page)).toHaveText('Share', { timeout: 6_000 });
  await expect(said(page)).toHaveText('');
});

test('a bout the public cannot read has no Share button', async ({ page }) => {
  await browserWith(page, 'opens');
  await open(page, `${PUBLIC}/e/test-event/match/bout-hidden`);

  await expect(page.getByRole('link', { name: 'Back to event home' })).toBeVisible();
  await expect(shareButton(page)).toHaveCount(0);
});

test("a Tournament's page shares its own address", async ({ page }) => {
  await browserWith(page, 'opens');
  await open(page, TOURNAMENT);
  await expect(page.getByRole('heading', { name: 'Longsword Open', level: 1 })).toBeVisible();

  await tapShare(page);

  expect((await doorsOf(page)).shared).toEqual([
    { title: 'Longsword Open · Open de Lyon', url: TOURNAMENT },
  ]);
});

test("a fighter's profile shares its own address with the same button", async ({ page }) => {
  await browserWith(page, 'none');
  await open(page, `${PUBLIC}/fighters/lea-martin`);
  await expect(page.getByRole('heading', { name: 'Léa Martin', level: 1 })).toBeVisible();

  await tapShare(page);

  expect((await doorsOf(page)).copied).toEqual([`${PUBLIC}/fighters/lea-martin`]);
  await expect(shareButton(page)).toHaveText('Copied!');
});

for (const [what, path, heading] of [
  ['a draft Tournament', '/e/test-event/t/sabre-draft', 'Sabre'],
  ['a Tournament of a draft Event', '/e/draft-event/t/longsword-open', 'Longsword Open'],
] as const) {
  test(`${what} opens for its club, with no Share button`, async ({ page, context }) => {
    await context.addCookies([{ name: 'sb-access-token', value: 'a-login', url: PUBLIC }]);
    await browserWith(page, 'opens');
    await open(page, `${PUBLIC}${path}`);

    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await expect(shareButton(page)).toHaveCount(0);
  });
}

test('Share is a 44 px target, in French for a French visitor, with no axe fault', async ({
  page,
  context,
}) => {
  await context.addCookies([{ name: 'mc_locale', value: 'fr', url: PUBLIC }]);
  await browserWith(page, 'none');
  await open(page, BOUT);

  await expect(shareButton(page)).toHaveText('Partager');
  const box = await shareButton(page).boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  // The row could stretch the button to its neighbour's height: the class holds the size.
  await expect(shareButton(page)).toHaveClass(/(^| )min-h-11( |$)/);
  await tapShare(page);
  await expect(shareButton(page)).toHaveText('Copié !');
  await expectNoCriticalAxeViolations(page);
});
