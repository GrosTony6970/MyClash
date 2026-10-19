/**
 * A bout scores with its own rules (the foundation, commit 4; rulings K and J).
 *
 * Story. Pool 1 starts on +3 buttons. The organiser switches the Tournament to
 * +2 at 10:00. Bout 2 started at 9:55: it keeps the +3 it started under. The
 * pad read its rules from the Tournament, so it showed +2, a 2 was queued, a 2
 * was stored. Now each bout read carries the bout's own rules, kept with the
 * bout on the tablet; the Tournament gives the display around them.
 *
 * The unit tests hold the composition and the keys (`bout-rules.test.ts`,
 * `penalty-catalogue.test.ts`, `keep-piste.test.ts`). Only a live page proves
 * what the referee presses. The API is stubbed (`pad-piste-stub.ts`): the
 * Tournament's `/match-config` says +2 / +1 at a cap of 5.
 */
import { test, expect, type Page } from '@playwright/test';
import { PAD, keptRow, openFirstBout, stubPiste, type PisteStub } from './pad-piste-stub';
import { boutRules } from './pad-rounds-score';

const press = (value: number) => ({ label: `+${value}`, value, visible: true });
/** The bout's own copy: +3 / +1, the card rules it pins. */
const ownRules = (cardRulesetId: string | null = null) => ({
  ...boutRules(false, 5),
  buttons: { clean: [press(3), press(1)], afterblow: [] },
  cardRulesetId,
});

const firstButton = (page: Page) =>
  page
    .locator('[data-testid="scoring-column"][data-side="red"]')
    .getByTestId('clean-hit-button')
    .first();
const notice = (page: Page) => page.getByText(/Scoring rules loaded from this tablet/);
const fromTablet = (page: Page) => page.getByTestId('bout-from-tablet');
const nextTile = (page: Page, name: RegExp) => page.getByRole('link', { name });

test('a bout scores with its own buttons, not its Tournament’s, online and from the tablet', async ({
  page,
}) => {
  const stub = await openFirstBout(page, { boutRules: () => ownRules() });

  await expect(firstButton(page)).toHaveText(/\+3/);
  // The bout's own rules and the Tournament's display, both from the server: nothing to say,
  // once the display has been read (no notice is shown while it is asked).
  await expect
    .poll(() => keptRow(page, '/api/v1/tournaments/tournament-1/match-config'))
    .not.toBeNull();
  await expect(notice(page)).toHaveCount(0);

  await expect.poll(() => keptRow(page, 'bout/match-2')).toMatchObject({ rules: ownRules() });
  stub.network = 'down';
  await nextTile(page, /Cy After/).click();

  await expect(page).toHaveURL(/\/matches\/match-2$/);
  await expect(fromTablet(page)).toBeVisible();
  await expect(firstButton(page)).toHaveText(/\+3/);
});

// Ruling J: a bout read without its own rules takes its Tournament's, as last
// read, and says they are not the bout's own.
test('a bout read without its own rules takes its Tournament’s, and says so', async ({ page }) => {
  await openFirstBout(page, { boutRules: null });

  await expect(firstButton(page)).toHaveText(/\+2/);
  await expect(notice(page)).toBeVisible();
});

test('a bout whose Tournament’s config is not held scores with its own rules, and says so', async ({
  page,
}) => {
  await openFirstBout(page, { rules: false, boutRules: () => ownRules() });

  await expect(firstButton(page)).toHaveText(/\+3/);
  await expect(notice(page)).toBeVisible();
});

const entry = (id: string, ref: number, name: string) => ({
  id,
  group_number: ref,
  ref_number: ref,
  short_name: name,
  description: `${name}, in full`,
  sanctions: ['yellow'],
});
const CARDS_A = {
  id: 'cards-a',
  name: 'House rules',
  accumulation_scope: 'match',
  penalty_ruleset_entries: [entry('entry-a', 1, 'Late on guard')],
};
const CARDS_B = {
  id: 'cards-b',
  name: 'Club rules',
  accumulation_scope: 'match',
  penalty_ruleset_entries: [entry('entry-b', 1, 'Leaving the piste')],
};
const entryButton = (page: Page, id: string) =>
  page.locator(`[data-side="red"] [data-testid="penalty-entry-button"][data-entry-id="${id}"]`);

// Two copies of ONE Tournament pin two card rulesets: bout 2 started before the
// organiser changed the card rules. With no network each bout shows its own.
test('with no network each bout shows the catalogue of its own card rules', async ({ page }) => {
  const stub = await openFirstBout(page, {
    boutRules: (id) => ownRules(id === 'match-2' ? 'cards-b' : 'cards-a'),
    catalogues: { 'match-1': CARDS_A, 'match-2': CARDS_B, 'match-3': CARDS_A },
  });
  await expect(entryButton(page, 'entry-a')).toBeVisible();
  await expect.poll(() => keptRow(page, 'penalty-ruleset/card/cards-b')).toEqual(CARDS_B);

  stub.network = 'down';
  await nextTile(page, /Cy After/).click();
  await expect(fromTablet(page)).toBeVisible();
  await expect(entryButton(page, 'entry-b')).toBeVisible();
  await expect(entryButton(page, 'entry-a')).toHaveCount(0);

  await nextTile(page, /Eli Third/).click();
  await expect(page).toHaveURL(/\/matches\/match-3$/);
  await expect(entryButton(page, 'entry-a')).toBeVisible();
  await expect(entryButton(page, 'entry-b')).toHaveCount(0);
});

/**
 * The Start names the copy its screen showed (the foundation, commit 5; ruling "Offline rules").
 *
 * Story. The wifi in the hall is down. On piste 2 the referee starts bout 2 under copy A (+3). At
 * the desk the organiser switches the Tournament: the server, which has not seen the Start, moves
 * bout 2 to copy B (+2). When the wifi is back the pad reads the bout BEFORE its Start lands:
 * the server still says `scheduled`, on B. The screen keeps A, says nothing, and the Start, which
 * names A with the evidence it was pressed with no network, keeps the bout on A.
 */
const IDLE = { status: 'idle', activeMs: 0, startedAt: null, levelResolutionSteps: 0 };
const RUNNING = {
  status: 'running',
  activeMs: 0,
  startedAt: '2026-01-01T10:00:00.000Z',
  levelResolutionSteps: 0,
};
const onCopy = (id: string | undefined, clean: number) => ({
  ...boutRules(false, 5),
  ...(id ? { id } : {}),
  buttons: { clean: [press(clean), press(1)], afterblow: [] },
  cardRulesetId: null,
});
const changed = (page: Page) => page.getByText('The organiser changed the rules of this match.');
const start = (page: Page) => page.getByTestId('clock-primary-button');
const clockBodies = (stub: PisteStub) =>
  stub.bodies.filter((sent) => sent.path.endsWith('/matches/match-2/clock')).map((s) => s.body);
const network = (page: Page, event: 'online' | 'offline') =>
  page.evaluate((name) => window.dispatchEvent(new Event(name)), event);

/** Bout 2, not started, open on the screen under `rules`, the network up. */
async function openSecondBout(page: Page, rules: unknown): Promise<PisteStub> {
  const stub = await stubPiste(page);
  Object.assign(stub, { boutRules: () => rules, clocks: { 'match-2': IDLE } });
  await page.goto(`${PAD}/matches/match-2`);
  await expect(start(page)).toBeEnabled();
  return stub;
}

/** The server reads bout 2 again (the page reads it when the network comes back). */
async function readAgain(page: Page, stub: PisteStub) {
  const before = stub.boutReads['match-2'] ?? 0;
  await network(page, 'online');
  await expect.poll(() => stub.boutReads['match-2'] ?? 0).toBeGreaterThan(before);
}

test('a Start pressed with no network keeps its copy when the read lands before it', async ({
  page,
}) => {
  const stub = await openSecondBout(page, onCopy('copy-a', 3));
  await expect(firstButton(page)).toHaveText(/\+3/);

  stub.network = 'down';
  await network(page, 'offline');
  await start(page).click();

  // The desk moved the bout; the Start's answer is held so the read lands first.
  stub.boutRules = () => onCopy('copy-b', 2);
  stub.holdClockPress = true;
  stub.network = 'up';
  await readAgain(page, stub);
  await expect.poll(() => clockBodies(stub).length).toBeGreaterThan(0);

  await expect(firstButton(page)).toHaveText(/\+3/);
  await expect(changed(page)).toHaveCount(0);
  // The copy a reload with no network opens holds A too, though the answer it kept said B.
  await expect
    .poll(() => keptRow(page, 'bout/match-2'))
    .toMatchObject({ status: 'scheduled', rules: { id: 'copy-a' } });
  expect(clockBodies(stub).at(-1)).toMatchObject({
    action: 'start',
    startedUnder: { rulesId: 'copy-a' },
    pressedWithoutNetwork: true,
  });

  // The server kept A: the read after the Start says so, and nothing is said.
  stub.statuses = { 'match-2': 'running' };
  stub.boutRules = () => onCopy('copy-a', 3);
  stub.clocks = { 'match-2': RUNNING };
  const reads = stub.boutReads['match-2'] ?? 0;
  stub.releaseClockPress();
  await expect.poll(() => stub.boutReads['match-2'] ?? 0).toBeGreaterThan(reads);
  await expect(firstButton(page)).toHaveText(/\+3/);
  await expect(changed(page)).toHaveCount(0);
});

// The tablet is opened again with the network back: the page sends its queue and reads the bout
// at once, and the read lands first. The screen holds no bout yet; the tablet's copy holds A.
test('a page opened again while its Start waits opens on the copy the bout started under', async ({
  page,
}) => {
  const stub = await openSecondBout(page, onCopy('copy-a', 3));
  await expect.poll(() => keptRow(page, 'bout/match-2')).toMatchObject({ rules: { id: 'copy-a' } });
  stub.network = 'down';
  await network(page, 'offline');
  await start(page).click();

  stub.boutRules = () => onCopy('copy-b', 2);
  stub.holdClockPress = true;
  stub.network = 'up';
  await page.reload();

  await expect(firstButton(page)).toHaveText(/\+3/);
  await expect(changed(page)).toHaveCount(0);
});

test('a bout moved to another copy before its Start: the buttons follow, the referee is told, the Start names it', async ({
  page,
}) => {
  const stub = await openSecondBout(page, onCopy('copy-a', 3));
  await expect(firstButton(page)).toHaveText(/\+3/);

  stub.boutRules = () => onCopy('copy-b', 2);
  await readAgain(page, stub);
  await expect(firstButton(page)).toHaveText(/\+2/);
  await expect(changed(page)).toBeVisible();

  await start(page).click();
  await expect.poll(() => clockBodies(stub).length).toBe(1);
  expect(clockBodies(stub)[0]).toMatchObject({ startedUnder: { rulesId: 'copy-b' } });
  expect(clockBodies(stub)[0]).not.toHaveProperty('pressedWithoutNetwork');
});

test('the same copy read again, or rules kept with no id: nothing is said', async ({ page }) => {
  const stub = await openSecondBout(page, onCopy('copy-a', 3));
  await readAgain(page, stub);
  await expect(changed(page)).toHaveCount(0);

  stub.boutRules = () => onCopy(undefined, 3);
  await readAgain(page, stub);
  stub.boutRules = () => onCopy('copy-b', 2);
  await readAgain(page, stub);
  await expect(firstButton(page)).toHaveText(/\+2/);
  await expect(changed(page)).toHaveCount(0);
});
