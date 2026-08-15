import { test, expect } from '@playwright/test';
import { LICE_A, LICE_B, MATCH_1, MATCH_2 } from './schedule-grid.fixture';
import {
  SCHEDULE_URL,
  card,
  dragAfterAbandonedDrag,
  dragCardToCell,
  mockApi,
  openDetailedGrid,
  slotOfCard,
} from './schedule-grid.harness';

/**
 * The schedule grid's DRAG WIRING, in a real browser, per commit.
 *
 * WHY THIS EXISTS: the drag *arithmetic* is well covered — 13 unit files over
 * the pure modules. What has never had a test is the DOM wiring around it: the
 * drag payload, the drop-target resolution, the undo history, and which request
 * a gesture finally emits. That wiring is exactly what the grid.tsx split moves,
 * so without this the refactor would have nothing catching a regression.
 *
 * It asserts the REQUEST a gesture produces, not the component's internals.
 * That is the contract the split has to preserve; asserting anything finer would
 * break on a behaviour-preserving refactor and get deleted, which is how safety
 * nets die.
 *
 * Every API call is mocked (see ./schedule-grid.harness), so this runs in the
 * existing per-commit Playwright job with no API and no database. The prod suite
 * in tests/e2e needs a deployed stack and runs nightly — a net that reds a day
 * after the commit that broke it cannot protect a refactor.
 */

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

    // Well clear of M2, so nothing is displaced and the count is unambiguous.
    const empty = (await slotOfCard(page, 'LSW-P1-M2', LICE_B)) + 24;
    await dragCardToCell(page, 'LSW-P1-M1', LICE_B, empty);

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

    // M2 starts on lice B; drop it onto lice A, clear of M1.
    const empty = (await slotOfCard(page, 'LSW-P1-M1', LICE_A)) + 24;
    await dragCardToCell(page, 'LSW-P1-M2', LICE_A, empty);

    await expect.poll(() => api.scheduleWrites().length).toBe(1);
    const write = api.scheduleWrites()[0]!;
    expect(write.matchId).toBe(MATCH_2);
    expect(write.body['liceId']).toBe(LICE_A);
  });

  /**
   * Dropping onto a slot another match already occupies CASCADES: the dragged
   * match takes the slot and the occupant is pushed clear, and both rows are
   * written in one operation (`placeWithShift` → `commitAll`).
   *
   * This is the assertion most worth having before the split, because the
   * cascade is the part a refactor is most likely to drop — losing it is
   * invisible on screen for the dragged card and leaves the lice double-booked
   * in the database, which is exactly what `20-schedule.spec.ts` forbids the
   * generator from producing.
   *
   * The occupied slot is READ from the rendered grid. An earlier version of
   * this spec computed it from an assumed 09:00 axis origin, landed on an empty
   * cell, and passed while asserting the opposite behaviour.
   */
  test('dropping on an occupied slot cascades the occupant out of the way', async ({ page }) => {
    const api = await openDetailedGrid(page);

    const occupied = await slotOfCard(page, 'LSW-P1-M2', LICE_B);
    await dragCardToCell(page, 'LSW-P1-M1', LICE_B, occupied);

    await expect.poll(() => api.scheduleWrites().length).toBe(2);
    const writes = api.scheduleWrites();

    // Both the dragged match and the displaced occupant are written.
    expect(writes.map((w) => w.matchId).sort()).toEqual([MATCH_1, MATCH_2].sort());
    // Both land on the target lice, and neither is left without a time.
    for (const w of writes) {
      expect(w.body['liceId']).toBe(LICE_B);
      expect(typeof w.body['scheduledAt']).toBe('string');
    }
    // The occupant is pushed LATER than the dragged match, not on top of it.
    const dragged = writes.find((w) => w.matchId === MATCH_1)!;
    const displaced = writes.find((w) => w.matchId === MATCH_2)!;
    expect(String(displaced.body['scheduledAt']) > String(dragged.body['scheduledAt'])).toBe(true);
  });

  /**
   * A drop acts on what the operator is HOLDING, never on something they let go
   * of earlier.
   *
   * The board used to track the dragged thing in six separate refs, each
   * drag-start site nulling whichever others it remembered. The Detailed view's
   * match card nulled none of them, and the drop handler tested the programme-bar
   * ref first — so abandoning a bar drag and then dragging a fight moved the BAR,
   * cascading every later match on the day, while the fight stayed put.
   *
   * Delete the payload union and this reds: zero schedule writes, one block move.
   */
  test('a drop ignores a payload left behind by an abandoned drag', async ({ page }) => {
    const api = await openDetailedGrid(page);

    const empty = (await slotOfCard(page, 'LSW-P1-M2', LICE_B)) + 24;
    await dragAfterAbandonedDrag(page, 'Lunch', 'LSW-P1-M1', LICE_B, empty);

    await expect.poll(() => api.scheduleWrites().length).toBe(1);
    expect(api.scheduleWrites()[0]!.matchId).toBe(MATCH_1);
    // And the abandoned bar did not move — that write is the failure mode, so
    // its absence is the assertion, not a side note.
    const blockMoves = api.writes.filter((r) => new URL(r.url()).pathname.endsWith('/move'));
    expect(blockMoves).toHaveLength(0);
  });

  /**
   * Ctrl+Z puts the fight back where it was — and leaves the rest of the board
   * alone.
   *
   * The second half is the one worth having. The keyboard listener is registered
   * once with an empty dependency array, and the optimistic update it reaches
   * rewrites the whole `matches` array — so an undo that resolved a stale copy
   * of it would emit exactly the right PATCH and blank the board. That is
   * invisible to any assertion about the request, which is all the other cases
   * here check.
   */
  test('Ctrl+Z restores the moved fight without emptying the board', async ({ page }) => {
    const api = await openDetailedGrid(page);

    const empty = (await slotOfCard(page, 'LSW-P1-M2', LICE_B)) + 24;
    await dragCardToCell(page, 'LSW-P1-M1', LICE_B, empty);
    await expect.poll(() => api.scheduleWrites().length).toBe(1);

    await page.keyboard.press('Control+z');

    await expect.poll(() => api.scheduleWrites().length).toBe(2);
    const undone = api.scheduleWrites()[1]!;
    expect(undone.matchId).toBe(MATCH_1);
    expect(undone.body['liceId']).toBe(LICE_A);

    await expect(card(page, 'LSW-P1-M1')).toBeVisible();
    await expect(card(page, 'LSW-P1-M2')).toBeVisible();
  });

  /**
   * Ctrl+Z reaches a deleted bar.
   *
   * It could not before. There were two undo systems that ignored each other:
   * the toolbar buttons and the keyboard drove one stack that only knew about
   * drag placements, while a deleted bar went into a separate slot that only the
   * 6-second toast could reach — and once that toast expired the delete was
   * unrecoverable, because the toast WAS the history for it.
   *
   * Collapse the two back into separate stores and this reds: the keypress finds
   * an empty history and no block is re-created.
   */
  test('Ctrl+Z re-creates a deleted programme bar', async ({ page }) => {
    const api = await openDetailedGrid(page);

    await page.getByRole('button', { name: 'Delete Lunch' }).first().click();
    await page.getByRole('button', { name: 'Delete block' }).click();
    await expect.poll(() => api.writes.filter((r) => r.method() === 'DELETE').length).toBe(1);

    await page.keyboard.press('Control+z');

    await expect
      .poll(
        () =>
          api.writes.filter(
            (r) => r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/programme/blocks'),
          ).length,
      )
      .toBe(1);
  });

  /**
   * Hard rule 8, the half that has to be current.
   *
   * The fixture's Denis fights M1 and referees M2, an hour apart, so the board
   * starts silent. Putting M1 alongside M2 makes him both fighter and referee
   * at the same minute — and the warning has to appear off the cards on screen,
   * not off a fresh answer from the server, because the server has not been
   * told yet. The read count is the assertion that carries that: if the row
   * only appeared after a re-read, this would still show the row and would be
   * proving the wrong thing.
   */
  test('a drag that overlaps a referee with their own fight warns without re-reading', async ({
    page,
  }) => {
    const api = await openDetailedGrid(page);
    const banner = page.getByText('Referee conflicts');
    await expect(banner).toBeHidden();
    // A DELTA, never an absolute. This spec runs against `next dev`, where
    // StrictMode mounts every effect twice, so the board legitimately asks for
    // this endpoint two times on load. Asserting "one read" reds on a healthy
    // board; asserting "no further read" is the claim that actually matters.
    const readsBefore = api.readCount('/referee-match-assignments');

    // Same slot as M2, other piste: the two now run at the same minute, and
    // nothing is displaced so no second finding muddies the assertion.
    const slot = await slotOfCard(page, 'LSW-P1-M2', LICE_B);
    await dragCardToCell(page, 'LSW-P1-M1', LICE_A, slot);

    await expect(banner).toBeVisible();
    await expect(
      page.getByText(/Denis Referee fights LSW-P1-M1 .* referees LSW-P1-M2/),
    ).toBeVisible();
    // Derived, not fetched.
    expect(api.readCount('/referee-match-assignments')).toBe(readsBefore);
  });

  /**
   * The other half says how old it is. It is a re-read of pool crews, so it can
   * be minutes behind the cards — and a group that did not say so would let the
   * live half vouch for it.
   */
  test('the pool-crew group carries the time it was read', async ({ page }) => {
    const api = await openDetailedGrid(page);

    const slot = await slotOfCard(page, 'LSW-P1-M2', LICE_B);
    await dragCardToCell(page, 'LSW-P1-M1', LICE_A, slot);

    await expect(page.getByText('Pool crews, last read at 09:30')).toBeVisible();
    // 09:30 is the fixture's `asOf`, and the fixture event is Europe/Paris. The
    // string proves the EVENT clock only because the two agree here; the unit
    // test in referee-conflict-rows.test.ts is the one that runs a third zone.
    expect(api.readCount('/referee-crew-conflicts')).toBeGreaterThanOrEqual(1);
  });
});
