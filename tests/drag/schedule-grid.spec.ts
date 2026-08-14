import { test, expect, type Page, type Request } from '@playwright/test';
import {
  EVENT_ID,
  LICE_A,
  LICE_B,
  MATCH_1,
  MATCH_2,
  ORG_SLUG,
  eventFixture,
  licesFixture,
  meFixture,
  programmeFixture,
  scheduleFixture,
} from './schedule-grid.fixture';

/**
 * The schedule grid's DRAG WIRING, in a real browser, per commit.
 *
 * WHY THIS EXISTS: the drag *arithmetic* is well covered — 13 unit files over
 * the pure modules. What has never had a test is the DOM wiring around it: the
 * drag-payload refs, the drop-target resolution, and which request a gesture
 * finally emits. That wiring is exactly what the grid.tsx split moves, so
 * without this the refactor would have nothing catching a regression.
 *
 * It asserts the REQUEST a gesture produces, not the component's internals.
 * That is the contract the split has to preserve; asserting anything finer
 * would break on a behaviour-preserving refactor and get deleted, which is how
 * safety nets die.
 *
 * Every API call is mocked, so this runs in the existing per-commit Playwright
 * job with no API and no database. The prod suite in tests/e2e needs a deployed
 * stack and runs nightly — a net that reds a day after the commit that broke it
 * cannot protect a refactor.
 */

const ADMIN = 'http://localhost:3003';
const SCHEDULE_URL = `${ADMIN}/org/${ORG_SLUG}/events/${EVENT_ID}/schedule`;

/** The axis runs from 09:00 in 5-minute slots, so slot = (minutes since 09:00)/5. */
const SLOT_1200 = 36;
const SLOT_1500 = 72;

interface Harness {
  writes: Request[];
  /** Writes to PATCH /matches/:id/schedule, parsed. */
  scheduleWrites: () => Array<{ matchId: string; body: Record<string, unknown> }>;
}

/** The GET payload for a bootstrap path, or null when this spec does not own it. */
function readFixture(path: string): unknown | null {
  if (path.endsWith('/me')) return meFixture;
  if (path.endsWith(`/events/${EVENT_ID}/lices`)) return licesFixture;
  if (path.endsWith(`/events/${EVENT_ID}/schedule`)) return scheduleFixture;
  if (path.endsWith(`/events/${EVENT_ID}/programme`)) return programmeFixture;
  // LiveNowBanner reads `state.lices.some(...)`; an empty object here takes the
  // whole page down before the grid even mounts.
  if (path.endsWith(`/events/${EVENT_ID}/live-state`)) {
    return { currentBlock: null, lices: [], nextBlock: null };
  }
  if (path.endsWith(`/events/${EVENT_ID}`)) return eventFixture;
  return null;
}

/**
 * The response a write gets back. Shapes matter even for writes this spec does
 * not assert: the planner feeds a PUT's response straight into setBlocks, so a
 * bare `{}` crashes the page into its error boundary and every assertion below
 * would fail for a reason with nothing to do with dragging.
 */
function writeFixture(path: string): unknown {
  if (path.endsWith('/programme/suggest')) return { blocks: programmeFixture, warnings: [] };
  if (path.endsWith(`/events/${EVENT_ID}/programme`)) return programmeFixture;
  return {};
}

async function mockApi(page: Page): Promise<Harness> {
  const writes: Request[] = [];

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (request.method() !== 'GET') {
      writes.push(request);
      return route.fulfill({ status: 200, json: writeFixture(path) });
    }
    // Anything unrecognised must still answer — an unrouted request stalls the
    // mount effect and the page never finishes loading.
    return route.fulfill({ json: readFixture(path) ?? [] });
  });

  return {
    writes,
    scheduleWrites: () =>
      writes
        .filter((r) => /\/matches\/[0-9a-f-]{36}\/schedule$/i.test(new URL(r.url()).pathname))
        .map((r) => ({
          matchId: new URL(r.url()).pathname.split('/').slice(-2)[0] as string,
          body: (r.postDataJSON() ?? {}) as Record<string, unknown>,
        })),
  };
}

/** The draggable match card carrying `roundCode` — what the operator reads. */
function card(page: Page, roundCode: string) {
  return page.locator('[draggable="true"]').filter({ hasText: roundCode }).first();
}

/** Loads the grid and switches to the Detailed view, where the cells live. */
async function openDetailedGrid(page: Page): Promise<Harness> {
  const harness = await mockApi(page);
  await page.goto(SCHEDULE_URL);
  await expect(card(page, 'LSW-P1-M1')).toBeVisible();
  await page.getByRole('button', { name: 'Detailed grid' }).click();
  await expect(page.locator('[data-lice-id][data-slot]').first()).toBeAttached();
  return harness;
}

/**
 * Drives a drag from a match card onto one drop cell.
 *
 * Synthetic DragEvents rather than Playwright's `dragTo`: on this grid a real
 * native drag hangs Chromium's drag loop and the call never returns. React
 * attaches ordinary DOM listeners, so dispatching the same sequence runs
 * exactly the same handlers — which is the wiring under test.
 *
 * The cell is addressed by `data-lice-id` + `data-slot`. Those attributes exist
 * for this test: the cells are unlabelled siblings of the cards, positioned
 * only by inline grid coordinates, so otherwise a test would have to recompute
 * the axis layout to name one — and would break whenever that geometry moved.
 */
async function dragCardToCell(
  page: Page,
  roundCode: string,
  liceId: string,
  slot: number,
): Promise<void> {
  await page.evaluate(
    ([code, lice, slotIndex]) => {
      const src = [...document.querySelectorAll('[draggable="true"]')].find((e) =>
        (e.textContent ?? '').includes(code as string),
      );
      const dst = document.querySelector(`[data-lice-id="${lice}"][data-slot="${slotIndex}"]`);
      if (!src) throw new Error(`no draggable card matching ${String(code)}`);
      if (!dst) throw new Error(`no drop cell for lice ${String(lice)} slot ${String(slotIndex)}`);
      const dataTransfer = new DataTransfer();
      const fire = (el: Element, type: string) =>
        el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
      fire(src, 'dragstart');
      fire(dst, 'dragenter');
      fire(dst, 'dragover');
      fire(dst, 'drop');
      fire(src, 'dragend');
    },
    [roundCode, liceId, String(slot)],
  );
}

test.describe('schedule grid drag layer', () => {
  // The grid is a desktop workspace. At the default 1280x720 the match cards
  // land below the fold, where `document.elementFromPoint` answers null and a
  // drag cannot start at all — silently doing nothing rather than failing.
  test.use({ viewport: { width: 1680, height: 1600 } });

  test('renders every fixture match, piste and break bar', async ({ page }) => {
    await mockApi(page);
    await page.goto(SCHEDULE_URL);

    await expect(card(page, 'LSW-P1-M1')).toBeVisible();
    await expect(card(page, 'LSW-P1-M2')).toBeVisible();
    await expect(page.getByText('Piste 1').first()).toBeVisible();
    await expect(page.getByText('Piste 2').first()).toBeVisible();
    await expect(page.getByText('Lunch (13:00–14:00)')).toBeVisible();
  });

  /**
   * The core contract. A drop re-times the DRAGGED match onto the cell's piste
   * and time, in one PATCH carrying both fields.
   *
   * The six drag-payload refs are mutually nulled by hand at six sites today;
   * the failure that guards against is a stale ref naming the wrong match, so
   * the id in the URL is the assertion that matters most here.
   */
  test('dropping a match on an empty cell re-times exactly that match', async ({ page }) => {
    const api = await openDetailedGrid(page);

    await dragCardToCell(page, 'LSW-P1-M1', LICE_B, SLOT_1500);

    await expect.poll(() => api.scheduleWrites().length).toBe(1);
    const write = api.scheduleWrites()[0]!;

    expect(write.matchId).toBe(MATCH_1);
    // The payload PATCH /matches/:id/schedule accepts: a piste and an instant,
    // both present. A drop sending only one would move the card on screen and
    // half-move it in the database.
    expect(Object.keys(write.body).sort()).toEqual(['liceId', 'scheduledAt']);
    expect(write.body['liceId']).toBe(LICE_B);
    expect(typeof write.body['scheduledAt']).toBe('string');
  });

  /** The piste that lands is the drop target's, not the one the match came from. */
  test('a drop carries the target cell piste, not the source piste', async ({ page }) => {
    const api = await openDetailedGrid(page);

    // M2 starts on piste B; drop it onto piste A.
    await dragCardToCell(page, 'LSW-P1-M2', LICE_A, SLOT_1500);

    await expect.poll(() => api.scheduleWrites().length).toBe(1);
    const write = api.scheduleWrites()[0]!;
    expect(write.matchId).toBe(MATCH_2);
    expect(write.body['liceId']).toBe(LICE_A);
  });

  /**
   * CURRENT BEHAVIOUR, pinned deliberately rather than endorsed: dropping onto
   * a slot another match already occupies emits ONE write — the dragged match
   * moves and the occupant stays exactly where it was. No cascade, no warning,
   * and the piste ends up double-booked.
   *
   * That is the very state `20-schedule.spec.ts` forbids the generator from
   * producing ("one lice runs one match at a time"), reachable by hand. This
   * test exists so the grid.tsx split cannot change it by accident, and so that
   * fixing it later is a deliberate edit to this assertion rather than drift.
   */
  test('dropping on an occupied slot moves only the dragged match (no cascade)', async ({
    page,
  }) => {
    const api = await openDetailedGrid(page);

    // Slot 36 on piste B is exactly where M2 sits.
    await dragCardToCell(page, 'LSW-P1-M1', LICE_B, SLOT_1200);

    await expect.poll(() => api.scheduleWrites().length).toBe(1);
    const writes = api.scheduleWrites();
    expect(writes[0]!.matchId).toBe(MATCH_1);
    expect(writes.some((w) => w.matchId === MATCH_2)).toBe(false);
  });
});
