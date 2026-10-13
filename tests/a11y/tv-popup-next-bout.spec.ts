/**
 * The organiser's TV popup, five seconds after a bout ends: it goes to the
 * next bout's address WITHOUT loading the page (quick win T5).
 *
 * It used to load the next address. A page load ends fullscreen, so a popup put
 * in fullscreen on the hall's TV fell out of it after every bout.
 *
 * The API is stubbed (`tv-stub.ts`). A mark on the page's `window` tells a
 * screen that changed from a page that was loaded.
 */
import { test, expect } from '@playwright/test';
import { stubPublicApi } from './helpers';
import { ENDED, ENDED_BOUT, IDLE, NEXT_BOUT, markPage, pageKeptItsMark, stubBout } from './tv-stub';

const ADMIN = 'http://localhost:3003';

test('when its bout ends, the popup shows the next bout at its address, with no page load', async ({
  page,
}) => {
  await stubPublicApi(page);
  await stubBout(page, 'm-1', ENDED_BOUT, ENDED);
  await stubBout(page, 'm-2', NEXT_BOUT, IDLE);

  await page.goto(`${ADMIN}/display/m-1`);
  await expect(page.getByText('Match ended')).toBeVisible();
  await markPage(page);

  // The countdown is five seconds.
  await expect(page).toHaveURL(`${ADMIN}/display/m-2`, { timeout: 12_000 });
  await expect(page.getByText('Not started', { exact: true })).toBeVisible();
  await expect(page.getByText('Match ended')).toHaveCount(0);

  // Not asserted: no spinner. A new address is a new mount of the page for the
  // router, so the popup shows its spinner for one read. The piste TV keeps its
  // address and shows none (`tv-piste-follows-its-piste.spec.ts`).
  expect(await pageKeptItsMark(page)).toBe(true);
});
