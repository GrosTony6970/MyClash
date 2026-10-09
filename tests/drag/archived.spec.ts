import { test, expect, type Page } from '@playwright/test';
import { EVENT_ID, LICE_B, eventFixture, runScheduleFixture } from './schedule-grid.fixture';
import {
  SCHEDULE_URL,
  card,
  dragCardToCell,
  mockApi,
  settledReadCount,
  slotOfCard,
  type Harness,
  type MockOptions,
} from './schedule-grid.harness';

/**
 * The schedule board of an ARCHIVED Event, in a real browser (ruling 377).
 *
 * An Event archives itself a day after its last Tournament, and the server then
 * refuses every save this page can send. The board still let the organiser drag
 * a bout: the card moved, the server said no, the card went back. So on an
 * archived Event no drag starts, no resize starts, the board's buttons and the
 * planner's fields are closed, and the page sends no save at all.
 *
 * The other specs of this folder are the other half of the proof: the same
 * gestures on an Event that is not archived DO send their saves.
 */

const SCHEDULE_PATH = `/events/${EVENT_ID}/schedule`;
const ORG_ID = 'org-1';

/**
 * The board on an archived Event, read settled. Registered after `mockApi`, so it answers
 * first. The status comes from the club's own Event list (ruling 380): the public Event
 * read, which `mockApi` answers as published, says nothing of it.
 */
async function openArchivedBoard(page: Page, opts: MockOptions = {}): Promise<Harness> {
  const api = await mockApi(page, opts);
  await page.route('**/api/v1/organizations/slug/*', (route) =>
    route.fulfill({ json: { id: ORG_ID, name: 'Fixture Club' } }),
  );
  await page.route(`**/api/v1/organizations/${ORG_ID}/events`, (route) =>
    route.fulfill({ json: [{ ...eventFixture, status: 'archived' }] }),
  );
  // The archived banner asks for a waiting deletion request: none, as the API says it.
  await page.route('**/api/v1/deletion-requests/active**', (route) =>
    route.fulfill({ json: null }),
  );
  await page.goto(SCHEDULE_URL);
  return api;
}

test.describe('the schedule board of an archived Event', () => {
  // A desktop workspace; see schedule-grid.spec.ts.
  test.use({ viewport: { width: 1680, height: 1600 } });

  test('a dragged bout is not moved, and the toolbar and the planner are closed', async ({
    page,
  }) => {
    const api = await openArchivedBoard(page);
    await expect(card(page, 'LSW-P1-M1')).toBeVisible();
    await page.getByRole('button', { name: 'Detailed grid' }).click();
    await expect(page.locator('[data-lice-id][data-slot]').first()).toBeAttached();
    await expect(page.getByRole('button', { name: 'Clear day (2)', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '+ Add lice', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Pool Match duration (min)', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save programme' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Delete Lunch' }).first()).toBeDisabled();

    const empty = (await slotOfCard(page, 'LSW-P1-M2', LICE_B)) + 24;
    await dragCardToCell(page, 'LSW-P1-M1', LICE_B, empty);
    await settledReadCount(api, SCHEDULE_PATH);

    expect(api.writes.map((r) => `${r.method()} ${new URL(r.url()).pathname}`)).toEqual([]);
  });

  test('a run block is not edited, unscheduled or made by a double click', async ({ page }) => {
    const api = await openArchivedBoard(page, { schedule: runScheduleFixture() });
    const edit = page.getByRole('button', { name: 'Edit Pool A', exact: true });
    await expect(edit).toBeVisible();
    await expect(edit).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Unschedule Pool A', exact: true }),
    ).toBeDisabled();

    // A double click on an empty cell of the block view opens the "add a break" box. The
    // view's piste columns carry no name of their own: each one spans the grid from row 3.
    const columns = await page.evaluate(() => {
      const found = [...document.querySelectorAll<HTMLElement>('div')].filter((div) =>
        div.style.gridRow.startsWith('3 /'),
      );
      found.at(-1)?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientY: 400 }));
      return found.length;
    });
    expect(columns).toBeGreaterThan(0);
    await settledReadCount(api, SCHEDULE_PATH);

    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(api.writes.map((r) => `${r.method()} ${new URL(r.url()).pathname}`)).toEqual([]);
  });

  // The grip is no form control: a closed fieldset does nothing to a pointer.
  test("a Pool's block is not stretched", async ({ page }) => {
    const api = await openArchivedBoard(page, { schedule: runScheduleFixture() });
    await expect(page.getByRole('button', { name: 'Edit Pool A', exact: true })).toBeDisabled();
    await settledReadCount(api, SCHEDULE_PATH);
    const edge = await page.getByRole('separator', { name: 'Resize time of Pool A' }).boundingBox();
    const x = edge!.x + edge!.width / 2;
    const y = edge!.y + edge!.height / 2;

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 80, { steps: 4 });
    await page.mouse.up();
    await settledReadCount(api, SCHEDULE_PATH);

    expect(api.writes.map((r) => `${r.method()} ${new URL(r.url()).pathname}`)).toEqual([]);
  });

  // The strip is a `div` with the role of a button: a click or Enter on it asks to clear the run.
  test('the header strip of a run in the Detailed grid clears nothing', async ({ page }) => {
    const api = await openArchivedBoard(page, { schedule: runScheduleFixture() });
    await page.getByRole('button', { name: 'Detailed grid' }).click();
    const strip = page.locator('div[role="button"][draggable="true"]').first();
    await expect(strip).toBeVisible();

    await strip.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await strip.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await settledReadCount(api, SCHEDULE_PATH);

    expect(api.writes.map((r) => `${r.method()} ${new URL(r.url()).pathname}`)).toEqual([]);
  });
});
