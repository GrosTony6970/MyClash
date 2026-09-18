import { test, expect, type Page } from '@playwright/test';
import {
  EVENT_ID,
  LICE_B,
  RUN_MATCH_IDS,
  RUN_START,
  at,
  runScheduleFixture,
} from './schedule-grid.fixture';
import {
  SCHEDULE_URL,
  mockApi,
  settledReadCount,
  type Harness,
  type MockOptions,
} from './schedule-grid.harness';

/**
 * The run window's save (ADR-018), in a real browser, per commit.
 *
 * Its own file only because `schedule-grid.spec.ts` sits at the 400-line cap; it
 * mounts the same board through the same harness. It asserts the REQUEST the
 * window's Save produces. The server lays the run and checks the pistes, so the
 * contract is: ONE request naming the run, its start and — only when it changed —
 * its bout length; never the single-Match PATCH fan-out the window used to send,
 * one per bout, all at once, each start re-snapped to a 5-minute slot.
 */

const SCHEDULE_PATH = `/events/${EVENT_ID}/schedule`;
const RUN_PATH = `/events/${EVENT_ID}/schedule/run`;
const PLACEMENTS_PATH = `/events/${EVENT_ID}/schedule/placements`;

/** Loads the board on the six-bout Pool and opens that run's window. */
async function openRunWindow(
  page: Page,
  opts: MockOptions = {},
): Promise<{ api: Harness; reopen: () => Promise<void> }> {
  const api = await mockApi(page, { schedule: runScheduleFixture(), ...opts });
  await page.goto(SCHEDULE_URL);
  const edit = page.getByRole('button', { name: 'Edit Pool A', exact: true });
  const reopen = async () => {
    await edit.click();
    await expect(page.getByRole('dialog')).toBeVisible();
  };
  await reopen();
  return { api, reopen };
}

/** Every write's path, in the order the browser sent it. */
const writePaths = (api: Harness) => api.writes.map((r) => new URL(r.url()).pathname);

const dialog = (page: Page) => page.getByRole('dialog');
const lengthField = (page: Page) => dialog(page).getByLabel('Match length (min)', { exact: true });
const startField = (page: Page) => dialog(page).getByLabel('Start', { exact: true });
const save = (page: Page) => dialog(page).getByRole('button', { name: 'Save', exact: true });

test.describe('schedule grid run window', () => {
  // A desktop workspace; see schedule-grid.spec.ts.
  test.use({ viewport: { width: 1680, height: 1600 } });

  test('a typed length is ONE save of the whole run, from its own start', async ({ page }) => {
    // The board serves the run the server would have laid once the save lands,
    // so the reopened window can only show 7 if the board re-read after it.
    let api: Harness | undefined;
    const opened = await openRunWindow(page, {
      schedule: () => runScheduleFixture((api?.runWrites().length ?? 0) > 0 ? 7 : null),
    });
    api = opened.api;
    // The field shows the run's slot; the run itself starts at 10:43.
    await expect(startField(page)).toHaveValue('10:40');
    await expect(lengthField(page)).toHaveValue('');
    // The failed socket's one catch-up read lands about 1.5 s after mount. Saving
    // before it would let THAT read serve the new run, and the reopen below would
    // pass with no re-read of the save's own.
    await settledReadCount(opened.api, SCHEDULE_PATH);

    await lengthField(page).fill('7');
    await save(page).click();

    await expect.poll(() => opened.api.runWrites().length).toBe(1);
    const body = opened.api.runWrites()[0]!;
    expect(Object.keys(body).sort()).toEqual([
      'matchIds',
      'plannedDurationOverrideMinutes',
      'startAt',
    ]);
    expect([...(body['matchIds'] as string[])].sort()).toEqual([...RUN_MATCH_IDS].sort());
    expect(body['plannedDurationOverrideMinutes']).toBe(7);
    expect(body['startAt']).toBe(RUN_START);
    expect(opened.api.scheduleWrites()).toEqual([]);

    await expect(dialog(page)).toBeHidden();
    await expect
      .poll(async () => {
        await opened.reopen();
        const value = await lengthField(page).inputValue();
        await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
        return value;
      })
      .toBe('7');
  });

  test('moves the run to its new piste BEFORE it asks for the new length', async ({ page }) => {
    // A Pool's piste change is a client relocate: one batch save of its six
    // bouts. The server lays the run from the rows it reads, so those rows must
    // already sit on the new piste when the run save arrives — otherwise the
    // length is laid out against the piste the operator just left.
    const { api } = await openRunWindow(page);

    await dialog(page).getByRole('checkbox', { name: 'Piste 2' }).check();
    await dialog(page).getByRole('checkbox', { name: 'Piste 1' }).uncheck();
    await lengthField(page).fill('7');
    await save(page).click();

    await expect.poll(() => api.runWrites().length).toBe(1);
    expect(api.placementWrites()).toHaveLength(1);
    const rows = api.placementRows(0);
    expect(rows.map((r) => r['matchId']).sort()).toEqual([...RUN_MATCH_IDS].sort());
    for (const row of rows) expect(row['liceId']).toBe(LICE_B);
    expect(api.scheduleWrites()).toEqual([]);
    const paths = writePaths(api);
    const relocate = paths.findIndex((p) => p.endsWith(PLACEMENTS_PATH));
    expect(relocate).toBeGreaterThanOrEqual(0);
    expect(paths.findIndex((p) => p.endsWith(RUN_PATH))).toBeGreaterThan(relocate);
  });

  test('sends no run save at all when the piste change is refused', async ({ page }) => {
    // The key is the batch door's, not `…/schedule/run`'s. A half-applied save
    // is the thing being prevented: the run must not be re-laid at a new length
    // on a piste it never reached.
    const sentence = 'Piste already busy: this bout overlaps match LSW-PA-M4';
    const { api } = await openRunWindow(page, {
      writeAnswers: {
        [PLACEMENTS_PATH]: {
          status: 409,
          json: { type: 'about:blank', title: 'Conflict', status: 409, detail: sentence },
        },
      },
    });

    await dialog(page).getByRole('checkbox', { name: 'Piste 2' }).check();
    await dialog(page).getByRole('checkbox', { name: 'Piste 1' }).uncheck();
    await lengthField(page).fill('7');
    await save(page).click();

    await expect.poll(() => api.placementWrites().length).toBe(1);
    // Filtered, not bare: Next's own route announcer is a second role="alert",
    // and an unscoped one is a strict-mode violation in the built app.
    await expect(page.getByRole('alert').filter({ hasText: sentence })).toBeVisible();
    // The refused save re-reads the board. Letting the reads settle is what
    // gives a run save its chance to appear before this says none did.
    await settledReadCount(api, SCHEDULE_PATH);
    expect(api.runWrites()).toEqual([]);
  });

  test('a re-read landing on the open window cannot clear a length nobody typed', async ({
    page,
  }) => {
    // The window opens on a run with no typed length. The failed socket's
    // catch-up read then serves the same run carrying 7 — an organiser at
    // another desk typed it. The blank field is the length THIS window opened
    // on, so a save that only moves the start must send no length key at all;
    // reading the board again at save time would send `null` and clear the 7.
    let typedElsewhere: number | null = null;
    const { api } = await openRunWindow(page, {
      schedule: () => runScheduleFixture(typedElsewhere),
    });
    await expect(lengthField(page)).toHaveValue('');

    const atOpen = api.readCount(SCHEDULE_PATH);
    typedElsewhere = 7;
    // The failed socket's catch-up read lands about 1.5 s after mount, with the
    // window already open, and serves the 7. Asserting that it landed is what
    // keeps this case from passing on a board that never saw the new length.
    expect(await settledReadCount(api, SCHEDULE_PATH)).toBeGreaterThan(atOpen);
    await expect(lengthField(page)).toHaveValue('');

    await startField(page).fill('11:00');
    await save(page).click();

    await expect.poll(() => api.runWrites().length).toBe(1);
    expect(Object.keys(api.runWrites()[0]!).sort()).toEqual(['matchIds', 'startAt']);
  });

  test('a changed start alone sends no length, read on the Event clock', async ({ page }) => {
    const { api } = await openRunWindow(page);

    await startField(page).fill('11:00');
    await save(page).click();

    await expect.poll(() => api.runWrites().length).toBe(1);
    const body = api.runWrites()[0]!;
    expect(Object.keys(body).sort()).toEqual(['matchIds', 'startAt']);
    expect(body['startAt']).toBe(at('11:00'));
    expect(api.scheduleWrites()).toEqual([]);
  });

  test("a refused save shows the server's own sentence and re-reads the board", async ({
    page,
  }) => {
    const sentence = 'Piste already busy: this bout overlaps match LSW-PA-M4';
    const { api } = await openRunWindow(page, {
      writeAnswers: {
        [RUN_PATH]: {
          status: 409,
          json: { type: 'about:blank', title: 'Conflict', status: 409, detail: sentence },
        },
      },
    });
    const readsBefore = await settledReadCount(api, SCHEDULE_PATH);

    await lengthField(page).fill('7');
    await save(page).click();

    await expect(page.getByRole('alert').filter({ hasText: sentence })).toBeVisible();
    await expect.poll(() => api.readCount(SCHEDULE_PATH)).toBeGreaterThan(readsBefore);
    expect(api.runWrites()).toHaveLength(1);
  });

  test('sends nothing it cannot read: a length Save refuses, a start it names', async ({
    page,
  }) => {
    const { api } = await openRunWindow(page);

    // "abc" must not read as a blank field, which would clear the run's length.
    await lengthField(page).fill('abc');
    await expect(save(page)).toBeDisabled();

    await lengthField(page).fill('');
    await startField(page).fill('9h30');
    await save(page).click();

    await expect(
      page.getByRole('alert').filter({ hasText: 'The start time could not be read' }),
    ).toBeVisible();
    expect(api.runWrites()).toEqual([]);
    expect(api.scheduleWrites()).toEqual([]);
  });
});
