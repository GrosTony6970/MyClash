# Organiser Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bilingual organiser guide at `myclash.fr/guide` and `/en/guide`, from sign-up to
published results, with screenshots taken by a script from an invented test Event.

**Architecture:** Markdown pages in an Astro content collection inside `apps/web-marketing`. One
shared helper builds the static paths for both languages, and one `Guide.astro` layout (built on
`Base.astro`) renders a page, its table of contents and its "Next step" link. A separate
Playwright config, run by hand, builds a `test`-kind Event on the deployed stack through the E2E
helpers, captures PNGs into `src/assets/guide/`, and hard-deletes the Event afterwards.

**Tech Stack:** Astro 7 (content collections, `astro:assets`), node:test over `dist/`, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-organiser-guide-design.md`. Read it first: the page
table, the Event-kind table for page 0, the screenshot rulings and the anti-goals are all there.

## Global Constraints

- No new dependency. Astro's built-in content collections and `astro:assets` only.
- French is the default locale: FR at `/guide/…`, EN at `/en/guide/…`, and **the same slug in both
  languages**.
- Every guide page exists in both languages (hard rule 6). Shared chrome strings go in `CHROME` in
  `apps/web-marketing/src/i18n/ui.ts`. Page prose is per-locale Markdown.
- Screenshots are English UI only. The French pages reuse the same PNGs, with French alt text.
- No real person anywhere (hard rule 7). The roster is invented; never use
  `tests/e2e/fixtures/participants.sample.csv`, because it contains a real HEMA name. The E2E
  account and club may appear in the admin sidebar (operator ruling).
- The screenshot Event is `eventKind: 'test'` and is **never published as Standard**. It is
  hard-deleted after the run.
- Styling uses the tokens in `apps/web-marketing/src/styles/base.css` (`--blue`, `--dark`,
  `--grey-light`, `--font-display`, `--font-body`…); no raw colours.
- The button labels a page names are copied from `packages/i18n/src/messages/en/*.ts` (EN page) and
  `packages/i18n/src/messages/fr/*.ts` (FR page), never paraphrased.
- One slice = one commit. Before a commit: `git log --oneline -1`, stage explicit paths, and write
  the message to a file (`git commit -F`). Never use `git add -A` or heredocs.
- Run the `myclash-gates` skill chain before pushing.

## Review Focus

1. **A page added in one language only.** The FR/EN parity test must fail the build's test step
   (Task 1, test `guide pages exist in both languages`).
2. **A phone-width reader (400px).** The side table of contents must collapse above the page and
   must not push the body sideways (Task 1, manual check in Step 9, plus CSS with no fixed widths).
3. **A screenshot shows something that must not leak.** That means a real fighter name, or
   a Standard Event announced to followers. The roster check runs in Task 2, Step 2; the
   no-publish check runs in Task 2, Step 4.
4. **A guide step that drifts from the real screen.** Each content task copies its labels from
   the i18n files and ends with a check against the live screen (Tasks 3–5, final step).
5. **An image path that breaks in one locale.** The EN and FR files sit at the same depth and point
   at the same asset. A test asserts every guide `<img>` was emitted (Task 1).

---

### Task 1: Guide skeleton, index and page 0, with the contract tests

**Files:**

- Create: `apps/web-marketing/src/content.config.ts`
- Create: `apps/web-marketing/src/lib/guide.ts`
- Create: `apps/web-marketing/src/layouts/Guide.astro`
- Create: `apps/web-marketing/src/styles/guide.css`
- Create: `apps/web-marketing/src/pages/guide/[...slug].astro`
- Create: `apps/web-marketing/src/pages/en/guide/[...slug].astro`
- Create: `apps/web-marketing/src/content/guide/{fr,en}/index.md`
- Create: `apps/web-marketing/src/content/guide/{fr,en}/before-you-start.md`
- Modify: `apps/web-marketing/src/i18n/ui.ts` (the `Chrome` interface and both `CHROME` locales)
- Modify: `apps/web-marketing/src/components/Nav.astro`, `apps/web-marketing/src/components/Footer.astro`
- Modify: `apps/web-marketing/README.md` (Pages table)
- Test: `apps/web-marketing/test/site.test.mjs`

**Interfaces:**

- Produces: collection `guide` with schema
  `{ title: string; description: string; order: number /* int ≥ 0; index = 0 */ }`.
  The entry id is `<locale>/<slug>` (e.g. `en/pools`); the file `index.md` is the `/guide` page.
- Produces: `guideStaticPaths(locale: Locale): Promise<Array<{ params: { slug: string | undefined }; props: { entry: CollectionEntry<'guide'>; pages: CollectionEntry<'guide'>[] } }>>`
  in `src/lib/guide.ts`. `pages` holds that locale's entries sorted by `order`. Both route files
  are one line: `export const getStaticPaths = () => guideStaticPaths('fr' | 'en')`, then they
  render `<Guide locale=… entry=… pages=… />`.
- Produces: `Guide.astro` props `{ locale: Locale; entry: CollectionEntry<'guide'>; pages: CollectionEntry<'guide'>[] }`.
  It passes `route = '/guide' | '/guide/<slug>'` to `Base`. The markup classes later tasks rely
  on: `.guide-toc` (contents), `a.guide-next` (next-step link, absent on the last page),
  `aside.guide-warn` (written as raw HTML inside Markdown, for "Hard to undo" callouts).
- Produces: new `CHROME` keys `navGuide`, `guideContents`, `guideNext`.
  FR: `'Guide'`, `'Sommaire'`, `'Étape suivante'`. EN: `'Guide'`, `'Contents'`, `'Next step'`.
  **Deviation from the spec:** the "Hard to undo" / "Difficile à annuler" heading is written
  inside each `aside.guide-warn` in the Markdown, not in `CHROME`. The site has no MDX, so
  Markdown cannot read `CHROME`, and adding MDX would be a new dependency.

- [ ] **Step 1: Write the failing tests** in `test/site.test.mjs`:

```js
const GUIDE_SRC = join(HERE, '..', 'src', 'content', 'guide');
const guideRoutes = (prefix) =>
  [...pages.keys()].filter((r) => r === prefix || r.startsWith(`${prefix}/`));

test('guide pages exist in both languages, one per Markdown file', () => {
  const fr = guideRoutes('/guide');
  const en = guideRoutes('/en/guide').map((r) => r.slice(3));
  const frFiles = readdirSync(join(GUIDE_SRC, 'fr')).filter((f) => f.endsWith('.md'));
  const enFiles = readdirSync(join(GUIDE_SRC, 'en')).filter((f) => f.endsWith('.md'));
  assert.deepEqual(enFiles.sort(), frFiles.sort(), 'the FR and EN guide sources differ');
  assert.ok(frFiles.length >= 2, `expected at least the index and page 0, found ${frFiles.length}`);
  assert.equal(fr.length, frFiles.length);
  assert.deepEqual(en.sort(), fr.sort(), 'the FR and EN guides do not build the same pages');
});

test('every guide page but the last links to the next one', () => {
  for (const prefix of ['/guide', '/en/guide']) {
    const withNext = guideRoutes(prefix).filter((r) => /class="guide-next"/u.test(pages.get(r)));
    assert.equal(withNext.length, guideRoutes(prefix).length - 1, `${prefix}: next-step links`);
  }
});

test('every image on a guide page was emitted', () => {
  for (const route of [...guideRoutes('/guide'), ...guideRoutes('/en/guide')]) {
    const html = pages.get(route);
    const srcs = [
      ...[...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gu)].map((m) => m[1]),
      ...[...html.matchAll(/\bsrcset="([^"]+)"/gu)].flatMap((m) =>
        m[1].split(',').map((c) => c.trim().split(/\s+/u)[0]),
      ),
    ];
    for (const src of srcs) {
      assert.ok(existsSync(join(DIST, src.split('?')[0])), `${route} shows ${src}, not in dist/`);
    }
  }
});

test('the sitemap lists every guide page', () => {
  const sitemap = readdirSync(DIST)
    .filter((f) => /^sitemap-\d+\.xml$/u.test(f))
    .map((f) => readFileSync(join(DIST, f), 'utf8'))
    .join('\n');
  for (const route of [...guideRoutes('/guide'), ...guideRoutes('/en/guide')]) {
    assert.ok(sitemap.includes(`https://myclash.fr${route}<`), `sitemap misses ${route}`);
  }
});

test('the nav links to the guide in each language', () => {
  assert.match(pages.get('/'), /<nav[\s\S]*?href="\/guide"[\s\S]*?<\/nav>/u);
  assert.match(pages.get('/en'), /<nav[\s\S]*?href="\/en\/guide"[\s\S]*?<\/nav>/u);
});
```

Also raise the `pages.size >= 7` floor in `before()` to `>= 11`.

- [ ] **Step 2: Run the tests to check they fail**

Run: `pnpm --filter @myclash/web-marketing test`
Expected: FAIL. `GUIDE_SRC` does not exist (ENOENT), and the page-count floor fails.

- [ ] **Step 3: Add the collection, helper, layout, routes and CSS** per the Interfaces block.
  - `content.config.ts`: `defineCollection` with the `glob` loader (`base: './src/content/guide'`,
    `pattern: '**/*.md'`) and the zod schema above (`import { z } from 'astro/zod'`).
  - `Guide.astro`: a two-column grid. The left column is `.guide-toc`: an ordered list of the
    locale's pages, with the current page marked `aria-current="page"`. The right column is a
    `<main id="main-content">` holding the `h1` (title), the rendered body, and `a.guide-next`
    pointing at the next page by `order` (label `CHROME.guideNext` plus the next page's
    title).
  - Below `48rem`, use one column with the contents list above the body, inside a `<details>` that
    is closed by default (summary: `CHROME.guideContents`).
  - `guide.css`: `.guide-warn` is a bordered box with `--red` on the left border. Give body images
    `max-width: 100%; height: auto` and a 1px `--grey-mid` border. Line length stays at or under
    `75ch`.
  - Nav: add `<li><a href={localePath(locale, '/guide')}>{t.navGuide}</a></li>` as the first item
    of `.nav__links`. Footer: the same link in its link row.

- [ ] **Step 4: Write `index.md` and `before-you-start.md` in FR and EN.**
  - Index (`order: 0`): one paragraph on who the guide is for. Testers on a Test Event can
    experiment freely. Then the list of the steps; a plain list is enough, since the layout's
    contents list does the navigation.
  - Page 0 (`order: 1`) covers three things:
    1. **Sign-up.** Sign up at `https://admin.myclash.fr/signup`. Step 1 is the account; step 2 is
       the club (its name and its web address). The club waits until the MyClash team approves it,
       and the organiser can create nothing until then.
    2. **The Event-kind table**, copied from the spec.
    3. **The advice**, copied from the spec: Test to try things out, a _new_ Standard Event for a
       real competition, Club for club nights and gradings. Then one `aside.guide-warn`: a
       Standard Event with results cannot be deleted.
  - Copy the label names from `packages/i18n/src/messages/{en,fr}/organizer.ts` → `events.kinds`.
  - Leave out the screenshot tags (`00-*.png`) here; Task 2 adds them.

- [ ] **Step 5: Run the tests to check they pass**

Run: `pnpm --filter @myclash/web-marketing test`
Expected: PASS, including the existing link, canonical/hreflang and lang-switch tests on the new
pages.

- [ ] **Step 6: Show each new test can go red**, one at a time, restoring with `git restore` or
      by deleting the new file:
  - Move `en/before-you-start.md` aside → the parity test fails.
  - Delete the `a.guide-next` markup → the next-link test fails.
  - Point the FR nav link at `/guides` → the nav test fails (and so does the existing link test).
  - Add `![x](../../../assets/guide/missing.png)` to one page → the build itself fails. That is
    the image guard while no screenshots exist; the dist test covers rewritten paths.
    Restore each change, then re-run Step 5.

- [ ] **Step 7: Run `pnpm --filter @myclash/web-marketing lint` and `typecheck`** (`astro check`).
      Expected: 0 errors, 0 warnings.

- [ ] **Step 8: Update the README Pages table** with the two `/guide/[...slug]` rows.

- [ ] **Step 9: Run `pnpm --filter @myclash/web-marketing dev`.** Open `/guide`,
      `/guide/before-you-start` and `/en/guide` at 1280px and at 400px. Check that no horizontal scroll
      appears, the contents box opens, and the language switch lands on the same page.

- [ ] **Step 10: Commit** with message
      `feat(marketing): an organiser guide, its first page and the tests that keep it bilingual`.
      Stage only the files listed above.

---

### Task 2: The screenshot script and its PNGs

**Files:**

- Create: `playwright.guide.config.ts` (repo root)
- Create: `tests/guide/screenshots.spec.ts`
- Create: `tests/guide/fixtures/guide-roster.csv`
- Create: `apps/web-marketing/src/assets/guide/*.png` (the output)
- Modify: `package.json` (root): script `"guide:screenshots": "playwright test -c playwright.guide.config.ts"`
- Modify: `tests/e2e/README.md`: a short section on the guide script, its env and its cleanup.
- Modify: `apps/web-marketing/src/content/guide/{fr,en}/before-you-start.md` (the `00-*` images)

**Interfaces:**

- Consumes: `tests/e2e/global-setup.ts` / `global-teardown.ts` (login and `tests/e2e/.auth/admin.json`),
  `runContext()` (`orgId`), `apiFor()`, `ensureRoster()`, `createPoolTournament()`,
  `playPoolPhase()`, `playTournamentToChampion()`, and the pad flow of
  `tests/e2e/16-pad-ui.spec.ts` / `18-staff-pad.spec.ts` (staff sign-in on `E2E_STAFF_URL`).
- Produces: these PNG names, which Tasks 3–5 reference as
  `../../../assets/guide/<name>.png`:

| File                         | Screen                                                        | Viewport |
| ---------------------------- | ------------------------------------------------------------- | -------- |
| `00-signup-account.png`      | admin `/signup`, step 1, logged-out context, empty            | 1280×800 |
| `00-signup-club.png`         | step 2, invented club name typed, **not submitted**           | 1280×800 |
| `01-event-form.png`          | `events/new`, filled, kind = Test, **not submitted**          | 1280×800 |
| `02-tournament-form.png`     | `tournaments/new`, filled, not submitted                      | 1280×800 |
| `02-tournament-settings.png` | the screenshot Tournament's settings (ruleset visible)        | 1280×800 |
| `03-import-preview.png`      | `persons/import` after uploading the roster CSV, preview step | 1280×800 |
| `03-persons.png`             | `persons` list                                                | 1280×800 |
| `04-pools.png`               | `pools` after generation                                      | 1280×800 |
| `05-schedule.png`            | `schedule` with the pool bouts laid                           | 1280×800 |
| `06-staff.png`               | `staff`                                                       | 1280×800 |
| `06-referee-assignments.png` | `referee-assignments`                                         | 1280×800 |
| `07-pad.png`                 | web-staff scoring pad mid-bout                                | 1180×820 |
| `07-live.png`                | `live`                                                        | 1280×800 |
| `08-bracket.png`             | `bracket` after the pool phase                                | 1280×800 |
| `09-final-ranking.png`       | `finalranking` after the champion                             | 1280×800 |

- [ ] **Step 1: Write `guide-roster.csv`** in the column format of
      `tests/e2e/fixtures/participants.sample.csv` (semicolon-separated, same header). It has 12
      fighters across 3 clubs: `Salle d'Armes de Testville` (`SAT`), `Cercle Exemple` (`CEX`) and
      `Les Lames Fictives` (`LLF`). Use common given names with **invented family names**: made-up
      words, not real surnames (e.g. `Brindevent`, `Morlacq`). Leave email and date of birth empty,
      and set `is_fighter` = 1. Mark two people as referees too (`is_referee` = 1).

- [ ] **Step 2: Check the roster leaks nothing**

Read the CSV with the Read tool. Confirm that every email cell is empty and no family name
appears in `participants.sample.csv`.
Expected: zero emails, and no overlap with the sample.

- [ ] **Step 3: Write `playwright.guide.config.ts`.** Copy `playwright.e2e.config.ts` and change:
      `testDir: './tests/guide'`, `retries: 0`, `timeout: 600_000`, `locale: 'en-GB'`, and
      `screenshot: 'off'`. Keep the same `globalSetup`, `globalTeardown` and `storageState`.

- [ ] **Step 4: Write `tests/guide/screenshots.spec.ts`**: one serial `describe`, with
      `afterAll` hard-deleting the Event (`DELETE events/:id?mode=hard`, allowed for `test` kind)
      even when a step failed.
  - Build the state through the API (the helpers above): an Event named `Testville Open 2099`
    with `eventKind: 'test'`, dates in 2099 and city `Testville`. Add one Longsword Tournament, a
    roster imported **through the import UI** (that also takes `03-import-preview.png`), 2 Pools,
    a schedule, the two referees qualified and assigned, then the pool phase played and the
    bracket played to a champion.
  - **Never** call `events/:id/publish` with any kind other than `test`, and never PATCH
    `eventKind`.
  - Before the first shot, assert the UI is English: the sidebar shows the English label of one
    nav item, taken from `packages/i18n/src/messages/en`.
  - Take each shot with `page.screenshot({ path: 'apps/web-marketing/src/assets/guide/<name>.png' })`,
    after waiting for the screen's main heading. Use no `fullPage`, so images stay a predictable
    size.

- [ ] **Step 5: Ask the operator before running.** The script writes to the deployed stack named
      by `E2E_BASE_URL` (today `https://admin.myclash.fr`): it creates a hidden Test Event and deletes
      it after. Run nothing until the operator says yes.

- [ ] **Step 6: Run it**

Run: `E2E_CLEANUP=1 pnpm guide:screenshots` (PowerShell: `$env:E2E_CLEANUP='1'; pnpm guide:screenshots`).
Expected: 1 passed. The 15 PNGs exist. `GET events/<id>` answers 404 afterwards, and global
teardown reports the throwaway E2E Event deleted.

- [ ] **Step 7: Look at every PNG** (Read tool). Check: English UI, no real fighter name, nothing
      blank or mid-load. Retake any that fail.

- [ ] **Step 8: Add the two `00-signup-*` images and `01-event-form.png`** (the kind field) to
      `before-you-start.md` in both languages, with alt text in each page's language. Run
      `pnpm --filter @myclash/web-marketing test`. Expected: PASS.

- [ ] **Step 9: Run `pnpm typecheck` and `pnpm lint`** from the root (the tests folder is
      type-checked). Expected: green.

- [ ] **Step 10: Commit** with message
      `test(guide): a script takes the guide's screenshots from a test Event it deletes after`.

---

### Task 3: Content, pages 1–3 (Event, Tournament, fighters)

**Files:**

- Create: `apps/web-marketing/src/content/guide/{fr,en}/create-event.md` (`order: 2`),
  `add-tournament.md` (`order: 3`), `register-fighters.md` (`order: 4`)

**Interfaces:**

- Consumes: the collection schema and `aside.guide-warn` (Task 1); the `01-`, `02-` and `03-` PNGs
  (Task 2).

- [ ] **Step 1: Read the screens being described:**
      `apps/web-admin/app/org/[slug]/events/new`, `venues`, `tournaments/new`,
      `tournaments/[tournamentId]/settings`, `persons`, `persons/import` and `registrations`. Also read
      their i18n keys in `packages/i18n/src/messages/{en,fr}/organizer.ts`. Note every place the code
      refuses an undo (a delete that 4xx's, a field locked after a state change). Each of those
      becomes an `aside.guide-warn`.
- [ ] **Step 2: Write the three pages in EN.** Use the page anatomy from the spec: a one-line
      "What you'll do", numbered steps with the exact labels, the screenshots, the warn boxes. For CSV
      import, name the columns from the header of `guide-roster.csv`.
- [ ] **Step 3: Write the three pages in FR** with the FR labels. Same images, French alt text.
- [ ] **Step 4: Run `pnpm --filter @myclash/web-marketing test`.** Expected: PASS (parity
      holds, the next-link chain extends, images are emitted).
- [ ] **Step 5: Check each page against the live screen.** Walk the steps on `pnpm dev`
      (web-admin) or on the stack, in both languages. Every label the page names must be on screen.
- [ ] **Step 6: Commit** with message
      `docs(guide): creating the Event, its Tournament and its fighters`.

### Task 4: Content, pages 4–6 (Pools, schedule, staff and referees)

Same steps as Task 3, for `pools.md` (`order: 5`), `schedule.md` (`order: 6`) and
`staff-referees.md` (`order: 7`). Read the `pools`, `schedule`, `staff`, `referees` and
`referee-assignments` screens.

- On `staff-referees`: state the rule on referees as the code enforces it (CLAUDE.md hard rule 8,
  `docs/decisions/ADR-016-referee-rules-one-checker.md`). Nobody referees while they fight,
  referee elsewhere or teach at the same time, or outside the availability they declared. The two
  soft rules can be switched off.
- Commit message: `docs(guide): Pools, the schedule, staff and referees`.

### Task 5: Content, pages 7–9 (event day, bracket, results)

Same steps as Task 3, for `event-day.md` (`order: 8`), `bracket.md` (`order: 9`) and `results.md`
(`order: 10`, the last page, so it has no `a.guide-next`). Read the `live`, `day`, `bracket`,
`finalranking` and `hema-ratings` screens, and the web-staff pad.

- On `event-day`: scoring keeps working when the wifi drops. The pad keeps the bouts and sends
  them when the network returns. Describe what the scorekeeper sees, from the pad's own i18n
  strings.
- On `results`: no screenshot of the HEMA Ratings export. Say that only a Standard Event can
  export, and that a Test or Club Event shows a blocked message.
- Commit message: `docs(guide): event day, the bracket and the results`.

### Task 6: Close the slice

**Files:**

- Modify: `docs/ARCHITECTURE.md` (§5.4bis, line ~517)
- Move: `docs/superpowers/specs/2026-11-18-organiser-guide-design.md` → `docs/superpowers/archive/specs/`
- Delete: `docs/superpowers/plans/2026-11-18-organiser-guide.md`

- [ ] **Step 1: Fix ARCHITECTURE.md.** It should say that `test` Events are hidden from the public,
      and that `club` Events are public but count toward no ranking, career stat or HEMA Ratings
      (per `packages/types/src/event-kind.ts`). Commit alone:
      `docs(architecture): club Events are public; only test Events are hidden`.
- [ ] **Step 2: Run the `myclash-gates` chain.** Expected: green.
- [ ] **Step 3: Move the spec and delete this plan.** Commit:
      `docs(guide): the organiser guide shipped; its spec moves to the archive`.
- [ ] **Step 4: `git fetch`, check that `origin/main` has not moved under you (rebase if it
      has), then push.**
