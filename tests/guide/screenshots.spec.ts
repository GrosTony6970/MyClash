import { mkdirSync, readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { runContext } from '../e2e/_context';
import { apiFor, type Api } from '../e2e/_api';
import {
  createBracketTournament,
  openForScoring,
  readBracket,
  scoreMatch,
  type Person,
} from '../e2e/_bracket';
import { playTournamentToChampion } from '../e2e/_tournament';
import { createPoolTournament, playPoolPhase, readPoolMatches } from '../e2e/_pool';
import { shootPadStates } from './_pad-states';
import { shootEventDay } from './_event-day';
import { shootBeyond } from './_beyond';

/**
 * The organiser guide's screenshots (its specs: docs/superpowers/archive/specs/*guide*).
 *
 * Builds one `test` Event — hidden from the public, never published, never switched to another
 * kind — walks it from the roster import to a champion, photographs each admin screen the guide
 * describes, and hard-deletes it at the end, whatever happened. The roster is invented
 * (tests/guide/fixtures); no real person may appear in a screenshot (hard rule 7).
 *
 * Run by hand: `E2E_CLEANUP=1 pnpm guide:screenshots`. It writes to the stack
 * that E2E_BASE_URL names.
 */

const OUT = 'apps/web-marketing/src/assets/guide';
const ROSTER = 'tests/guide/fixtures/guide-roster.csv';
const ROLES = ['arbitre_declarant', 'arbitre_assesseur', 'arbitre_table'];
const PIN = '481902';
const DESKTOP = { width: 1280, height: 800 };
const TABLET = { width: 1180, height: 820 };

interface RosterRow {
  givenName: string;
  familyName: string;
  fighter: boolean;
  referee: boolean;
}

/** The fixture's rows, in file order (the fighters' seed order). */
function readRoster(): RosterRow[] {
  const [, ...rows] = readFileSync(ROSTER, 'utf8').trim().split(/\r?\n/u);
  return rows.map((row) => {
    const cells = row.split(';');
    return {
      givenName: cells[0]!,
      familyName: cells[1]!,
      fighter: cells[9] === '1',
      referee: cells[10] === '1',
    };
  });
}

/**
 * Wait for the screen to settle, then save it as `<OUT>/<name>.png`.
 * `ready` names text the screen shows once loaded, for a screen without an h1.
 */
async function shot(page: Page, name: string, url?: string, ready?: RegExp): Promise<void> {
  if (url) await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(ready ? page.getByText(ready).first() : page.locator('h1').first()).toBeVisible();
  // Live screens hold a connection open, so idle may never come: settle or move on.
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

/** `POST events/:id/referees/:personId`, where "already a referee" is fine. */
async function ensureEventReferee(api: Api, eventId: string, personId: string): Promise<void> {
  const res = await api.post(`events/${eventId}/referees/${personId}`);
  if (res.status() !== 409) await api.ok(res);
}

test('the organiser guide screenshots', async ({ page, browser, request }) => {
  mkdirSync(OUT, { recursive: true });
  const api = apiFor(request);
  const { orgId, orgSlug, baseURL } = runContext();
  const staffBase = (process.env.E2E_STAFF_URL ?? `${baseURL}/staff`).replace(/\/$/u, '');
  const english = [{ name: 'mc_locale', value: 'en', url: baseURL }];
  if (!staffBase.startsWith(baseURL))
    english.push({ name: 'mc_locale', value: 'en', url: staffBase });
  await page.context().addCookies(english);
  // The E2E account may owe a terms acceptance, and the banner asking for it
  // would sit on top of every shot. Hide it in this browser only, by answering
  // `/me` with no pending terms. Nothing is accepted on the account.
  await page.route(/\/api\/v1\/me(\?.*)?$/u, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...body, pendingLegal: [] } });
  });
  const token = Date.now().toString(36);
  const admin = `/org/${orgSlug}/events`;

  // ── Page 0: the sign-up, signed out, never submitted ──────────────────────
  const visitor = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    ignoreHTTPSErrors: true,
    locale: 'en-GB',
    viewport: DESKTOP,
  });
  await visitor.addCookies(english);
  const signup = await visitor.newPage();
  await signup.goto(`${baseURL}/signup`, { waitUntil: 'networkidle' });
  await expect(signup.locator('#signup-email')).toBeVisible();
  await signup.screenshot({ path: `${OUT}/00-signup-account.png` });
  await signup.locator('#signup-email').fill('camille@example.com');
  await signup.locator('#displayName').fill('Camille Brindevent');
  await signup.getByRole('checkbox').check();
  await signup.getByRole('button', { name: 'Continue →' }).click();
  await signup.locator('#orgName').fill("Salle d'Armes de Testville");
  await expect(signup.getByText('✓ Available')).toBeVisible();
  await signup.screenshot({ path: `${OUT}/00-signup-club.png` });
  await visitor.close();

  // ── The Event: test kind, from the first call to the last ─────────────────
  const event = await api.json<{ id: string }>(
    await api.post(`organizations/${orgId}/events`, {
      data: {
        name: 'Testville Open 2099',
        slug: `guide-${token}`,
        startDate: '2099-05-02',
        endDate: '2099-05-03',
        city: 'Testville',
        country: 'FR',
        eventKind: 'test',
      },
    }),
  );
  const eventId = event.id;
  const at = `${admin}/${eventId}`;
  let deleted = false;

  try {
    const created = await api.json<{ event_kind?: string; eventKind?: string }>(
      await api.get(`events/${eventId}`),
    );
    expect(created.event_kind ?? created.eventKind, 'the guide Event must be a test Event').toBe(
      'test',
    );
    for (const name of ['Piste 1', 'Piste 2']) {
      await api.ok(await api.post(`events/${eventId}/lices`, { data: { name } }));
    }

    // ── Page 1: the event form, filled, never submitted ─────────────────────
    await page.goto(`${admin}/new`, { waitUntil: 'networkidle' });
    await expect(page.locator('html'), 'the screenshots must show the English UI').toHaveAttribute(
      'lang',
      'en',
    );
    const eventName = page.locator('#wizard-event-name');
    await expect(eventName).toHaveCount(1);
    await eventName.fill('Testville Open 2099');
    await page
      .locator('#wizard-event-city')
      .or(page.getByPlaceholder('Lyon'))
      .first()
      .fill('Testville');
    await page.locator('input[name="event-kind"][value="test"]').check();
    // Two shots of one form: the kind choice (page 0) and the top of the form (page 1).
    await page.locator('fieldset', { hasText: 'Event kind' }).scrollIntoViewIfNeeded();
    await shot(page, '00-event-kind');
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '01-event-form');

    // ── Concepts: rulesets and access (organisation screens, nothing written) ─
    const org = `/org/${orgSlug}`;
    await shot(page, '11-rulesets', `${org}/rulesets`);
    await shot(page, '11-ruleset-new', `${org}/rulesets/scoring/new`);
    // The members page lists emails. Only the E2E account may appear in the public
    // guide (operator ruling): if anyone else has joined this organisation, stop.
    // Read the emails only once a member row has rendered, or the check reads nothing.
    await page.goto(`${org}/settings`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('row').nth(1)).toBeVisible();
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    const shownEmails =
      // The whole page, sidebar included: this page has no <main>, and waiting for one hung.
      (await page.locator('body').innerText()).match(/[\w.+-]+@[\w-]+\.[\w.]+/gu) ?? [];
    const e2eEmail = (process.env.E2E_ADMIN_EMAIL ?? '').toLowerCase();
    expect(
      // innerText never holds the form's placeholder, so no address is exempt.
      shownEmails.filter((email) => email.toLowerCase() !== e2eEmail),
      'the members page shows someone other than the E2E account — not taking that screenshot',
    ).toEqual([]);
    await shot(page, '11-org-members');

    // ── Page 3: the roster, imported through the screen ─────────────────────
    await page.goto(`${at}/persons/import`, { waitUntil: 'networkidle' });
    const fileInput = page.getByTestId('import-file-input');
    await expect(fileInput).toHaveCount(1);
    await fileInput.setInputFiles({
      name: 'guide-roster.csv',
      mimeType: 'text/csv',
      buffer: readFileSync(ROSTER),
    });
    await page.getByTestId('import-validate').click();
    const commit = page.getByTestId('import-commit');
    await expect(commit).toBeEnabled();
    // Earlier runs left these invented people as profiles, and the preview offers
    // each row as a duplicate with "create new" pre-chosen. Never create them
    // again (operator ruling, part 2 spec): link when EVERY row is suggested, and
    // otherwise STOP — a partial match may be a stranger with the same name, and
    // creating is how five runs left ~90 invented profiles behind. Only a roster
    // with no duplicate at all (the very first run on a stack) is created.
    //
    // Wait for the preview to settle first: the commit button enables before the
    // duplicates section renders, and reading it then saw no duplicates at all.
    const rows = readRoster().length;
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    const duplicates = page.getByText('Duplicates (need a decision)').first();
    const hasDuplicates = await duplicates
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (hasDuplicates) {
      // The server pre-chooses each row: sometimes "link", sometimes "create new".
      // "Link all suggested" is enabled only while some row is not linked yet.
      const linkAll = page.getByRole('button', { name: /^Link all suggested/ }).first();
      if (await linkAll.isEnabled()) await linkAll.click();
      // Whatever the default was, every row must now link — or the run stops here,
      // before the import is committed.
      await expect(
        page.getByText(new RegExp(`^\\s*${rows}\\s*will link`, 'u')).first(),
        `not all ${rows} rows link to an existing profile — refusing to create duplicates`,
      ).toBeVisible();
    } else {
      // No duplicate seen: a first run on this stack. Commit only when the preview
      // really says every row is new — a late-rendering duplicates section (the
      // race that once added 54 profiles) shows up here as a missing "will create".
      await expect(
        page.getByText(new RegExp(`^\\s*${rows}\\s*will create`, 'u')).first(),
        `the preview does not show ${rows} new rows — not committing the import`,
      ).toBeVisible();
      await expect(page.getByText(/^\s*0\s*will link/u).first()).toBeVisible();
    }
    await shot(page, '03-import-preview');
    await commit.click();
    await expect(page.getByText(/Import complete/i)).toBeVisible();
    await shot(page, '03-persons', `${at}/persons`);

    const roster = readRoster();
    const persons = await api.json<Array<Person & { globalPersonId: string | null }>>(
      await api.get(`events/${eventId}/persons`),
    );
    const personOf = (row: RosterRow) => {
      const found = persons.find(
        (p) => p.givenName === row.givenName && p.familyName === row.familyName,
      );
      expect(found, `${row.givenName} ${row.familyName} was not imported`).toBeTruthy();
      return found!;
    };
    const fighters = roster.filter((row) => row.fighter).map(personOf);
    const referees = roster.filter((row) => row.referee).map(personOf);

    // ── Page 2: the tournament form, then the tournament itself ─────────────
    await page.goto(`${at}/tournaments/new`, { waitUntil: 'networkidle' });
    const tournamentName = page.getByTestId('tournament-name');
    await expect(tournamentName).toHaveCount(1);
    await tournamentName.fill('Longsword Open');
    await shot(page, '02-tournament-form');

    const tournament = await createPoolTournament(api, eventId, {
      name: 'Longsword Open',
      slug: `longsword-open-${token}`,
      fighters,
      poolCount: 2,
    });
    await shot(page, '02-tournament-settings', `${at}/tournaments/${tournament.id}/settings`);

    // ── Pages 4 and 5: pools, laid on two pistes ────────────────────────────
    await shot(page, '04-pools', `${at}/pools`);
    await api.ok(
      await api.post(`events/${eventId}/programme/blocks`, {
        data: {
          dayIndex: 0,
          blockType: 'competition',
          label: 'Pools',
          startTime: '09:00',
          endTime: '13:00',
          liceCount: 2,
          competitionId: tournament.id,
          competitionPhase: 'pool',
        },
      }),
    );
    await api.ok(await api.post(`events/${eventId}/programme/generate`, { data: {} }));
    await shot(page, '05-schedule', `${at}/schedule`);

    // ── Page 6: a scoring tablet account, qualified referees, auto-assign ───
    await api.ok(
      await api.post(`events/${eventId}/staff-accounts`, {
        data: {
          displayName: 'Piste 1 tablet',
          username: `piste1-${token}`,
          pin: PIN,
          role: 'scoring',
        },
      }),
    );
    for (const referee of referees) {
      await ensureEventReferee(api, eventId, referee.id);
      // Qualifications key on the GLOBAL person id (see 21-referee-assign).
      const personId = referee.globalPersonId ?? referee.id;
      for (const role of ROLES) {
        await api.ok(
          await api.put(`events/${eventId}/referee-qualifications`, {
            data: { personId, role, rating: 4 },
          }),
        );
      }
    }
    await api.ok(await api.post(`events/${eventId}/referee-assignment-preview`));
    await api.ok(await api.post(`events/${eventId}/referee-assignment-preview/apply`));
    await shot(page, '06-staff', `${at}/staff`);
    await shot(page, '06-referee-assignments', `${at}/referee-assignments`);

    // ── Page 7: the pad on a tablet, and the live room ──────────────────────
    const [firstBout] = await readPoolMatches(api, tournament.id);
    expect(firstBout, 'the pools produced no bout').toBeTruthy();
    await openForScoring(api, firstBout!.id);
    await page.setViewportSize(TABLET);
    await page.goto(`${staffBase}/matches/${firstBout!.id}`);
    await expect(page.getByTestId('network-bar')).toHaveAttribute('data-network', 'online');
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    await page.screenshot({ path: `${OUT}/07-pad.png` });

    // ── Scoring pad reference: one bout through every state (selectors from 16-pad-ui) ─
    const padBout = (await readPoolMatches(api, tournament.id))[1];
    expect(padBout, 'the pools produced no second bout').toBeTruthy();
    await shootPadStates(page, api, padBout!.id, staffBase, OUT);
    await page.setViewportSize(DESKTOP);
    // ── Event day: the desk and gear tablets, the venue screens, a bout's page
    await shootEventDay(page, browser, api, eventId, firstBout!.id, padBout!.id, OUT);
    await shot(page, '07-live', `${at}/live`, /pistes ·/u);

    // ── Pages 8 and 9: the bracket from the pool standings, then the ranking ─
    await playPoolPhase(api, tournament);
    await api.ok(
      await api.post(`tournaments/${tournament.id}/generate-bracket`, {
        data: { phaseType: 'single_elim', qualifyCount: 8 },
      }),
    );
    await api.ok(await api.post(`tournaments/${tournament.id}/populate-bracket`, { data: {} }));
    await shot(page, '08-bracket', `${at}/bracket`);

    // Play round by round: a round's winners fill the next round's slots.
    for (let round = 0; round < 10; round++) {
      const open = (await readBracket(api, tournament.id)).slots.filter(
        (s) => s.matchId && s.redRegistrationId && s.blueRegistrationId && s.status !== 'completed',
      );
      if (open.length === 0) break;
      for (const slot of open) await scoreMatch(api, slot.matchId!, 'red');
    }
    const unfinished = (await readBracket(api, tournament.id)).slots.filter(
      (s) => s.matchId && s.status !== 'completed',
    );
    expect(unfinished, 'the bracket did not play to a champion').toEqual([]);
    await shot(page, '09-final-ranking', `${at}/finalranking`);
    await shootBeyond(page, api, { eventId, people: roster.map(personOf), out: OUT });

    // ── Formats: a double elimination played through, and a Swiss round drawn ─
    await playTournamentToChampion(api, eventId, {
      name: 'Double Elimination Cup',
      slug: `de-cup-${token}`,
      fighters: fighters.slice(0, 8),
    });
    await page.goto(`${at}/bracket`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Double Elimination Cup' }).first().click();
    await shot(page, '12-double-elim');

    const swiss = await createBracketTournament(api, eventId, {
      name: 'Swiss Cup',
      slug: `swiss-cup-${token}`,
      fighters: fighters.slice(0, 8),
    });
    await api.ok(
      await api.post(`tournaments/${swiss.id}/generate-swiss`, {
        data: { roundCount: 3, seedingStrategy: 'random' },
      }),
    );
    await page.goto(`${at}/swiss`, { waitUntil: 'domcontentloaded' });
    // A click before hydration does nothing, so click until the breadcrumb names
    // the Swiss tournament too (its name then shows twice: chip + breadcrumb).
    await expect(async () => {
      await page.getByRole('button', { name: 'Swiss Cup' }).first().click();
      await expect(page.getByText('Swiss Cup', { exact: true })).toHaveCount(2, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await shot(page, '12-swiss');
  } finally {
    // A test Event may be hard-deleted with results in it (`allowsDirectHardDelete`).
    // Logged, not asserted, here: an assertion in `finally` would replace the
    // error that brought the run here.
    const gone = await api.delete(`events/${eventId}?mode=hard`);
    deleted = gone.ok();
    if (!deleted) console.error(`[guide] Event ${eventId} NOT deleted: ${gone.status()}`);
  }
  expect(deleted, `the guide Event ${eventId} was not deleted`).toBe(true);
});
