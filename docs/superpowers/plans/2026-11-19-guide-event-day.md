# Organiser guide, part 3: the event day — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five new guide pages in FR and EN under a renamed "Event day" section, with screenshots.

**Architecture:** Markdown pages in the existing `guide` content collection
(`apps/web-marketing/src/content/guide/{fr,en}/`), checked by the existing contract tests over
`dist/`. Screenshots come from the hand-run Playwright script `tests/guide/screenshots.spec.ts`,
extended through a new module so the spec stays under 400 lines.

**Tech Stack:** Astro 7 content collections, node:test, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-19-guide-event-day-design.md`

## Global Constraints

- Every page exists in `fr/` and `en/` with the same slug, `order` and `section` (hard rule 6).
- UI labels are quoted from `packages/i18n/src/messages/{en,fr}`; every fact is checked in code.
- No real person in a screenshot (hard rule 7); the screenshot Event is `test` kind and deleted.
- Ask the operator before running the screenshot script on the deployed stack.
- Each printed sheet fits on one A4 page in both languages (Playwright `page.pdf`, format A4).
- `quality:complexity`: 400 lines per file, 50 per function.

## Review Focus

1. A fact on a page that the code contradicts (labels, roles, what is refused). The recon
   reports cite file:line; the reviewer re-checks the claims that carry a role or a refusal.
2. A sheet that prints on two pages in one language only (French runs longer).
3. A screenshot that shows a real person or another Event of the E2E club.
4. The fighters page telling fighters something that only works with an account, or at a
   published Event, without saying so.
5. The "Next step" chain: page 17 now has a next page; page 22 is last.

---

### Task 1: Rename the third section to "Event day"

**Files:** `src/content.config.ts:27`, `src/i18n/ui.ts:56,84,110`, `src/layouts/Guide.astro:32-35`,
the four `section: pad` pages, `test/guide.test.mjs:56`.

- [ ] Test first: in `guide.test.mjs` set `SECTION_KEYS` to
      `['guideSectionSteps', 'guideSectionConcepts', 'guideSectionDay']`. Run
      `pnpm --filter @myclash/web-marketing test`; Expected: FAIL, "the copy table lost a section
      label".
- [ ] Rename the enum value `pad` → `day` and the key `guideSectionPad` → `guideSectionDay`,
      labels FR `Le jour J`, EN `Event day`; update the four pages' frontmatter.
- [ ] Run the test; Expected: PASS. Commit `feat(guide): the third section is the event day`.

### Task 2: Welcome desk and gear check sheets (orders 18, 19)

**Files:** `src/content/guide/{fr,en}/welcome-desk-sheet.md`, `…/gear-check-sheet.md`.

- [ ] Write both pages in both languages, shaped like `scorekeeper-sheet.md` (numbered steps, a
      "Call the organiser when" list, no image). Desk: sign in (link + PIN), search, **Arrived**,
      **Undo**, **Arrived today**, **Scan QR**, the tabs, no network = not saved, it blocks nothing.
      Gear: **Pass**, **Conditional** (reason required), **Fail**, **Re-check** (no undo), the
      result shows on the pad, it never stops a bout, no network = not saved.
- [ ] Run the tests; Expected: PASS (parity, next chain, sitemap pick the pages up).
- [ ] Print each sheet to PDF (A4) from `astro preview` in both languages; Expected: 1 page each.
- [ ] Commit `docs(guide): sheets for the welcome desk and the gear check`.

### Task 3: Screens at the venue (order 20)

- [ ] `venue-screens.md` FR + EN: the piste screen (public, `/e/<slug>/lice/<piste>/display`,
      its controls, where the link is: Event Staff → "External display URLs", Live → "Piste kiosk"),
      the screen list (`/e/<slug>/display`, Staff sign-in panel), the bout pop-up ("External
      display" on the pad opened from the admin), the live wall (`/display/wall/<eventId>`, typed by
      hand, scorekeeper role or above), the Live page for phones; Test/Draft Events need the screen
      signed in; a network drop keeps the last picture; the screen shows what the server holds, so
      offline hits appear when the tablet syncs.
- [ ] Tests PASS. Commit `docs(guide): the screens at the venue`.

### Task 4: When something goes wrong (order 21)

- [ ] `when-things-go-wrong.md` FR + EN, one section per symptom (spec list), each with what to
      do, the role needed, and what is refused. Includes: after the Event is completed, a correction
      is a request that a MyClash platform admin approves.
- [ ] Tests PASS. Commit `docs(guide): what to do when something goes wrong on the day`.

### Task 5: For your fighters (order 22, last page)

- [ ] `for-fighters.md` FR + EN: a short organiser preface (publish Standard or Club; enter
      emails; passes can be emailed), then to the fighter: looking without an account, quick access,
      claiming a profile, My schedule, the pass, notifications (account needed, push or email),
      Workshop sign-up, following people, what is public, the app install.
- [ ] Tests PASS. Commit `docs(guide): a page for the organiser to send to fighters`.

### Task 6: Screenshots

**Files:** Create `tests/guide/_event-day.ts`; modify `tests/guide/screenshots.spec.ts`.

- [ ] `shootEventDay(page, browser, api, opts)` saves: `14-desk.png` and `14-gear.png` (a
      check-in and a gear account created through the API, each signed in with its PIN in a fresh
      context, as `tests/e2e/44-desk-screens.spec.ts` does), `15-venue-scoreboard.png` (admin
      `/display/<matchId>` of the opened first bout), `15-live-wall.png` (admin
      `/display/wall/<eventId>`), and `16-match-page.png` (the ended pad bout's admin match page).
      The fighters page gets no screenshot: the Test Event is hidden from the public site.
- [ ] `pnpm exec tsc --noEmit -p tests` is not available (root `tests/` has no typecheck): read
      the module carefully and run `pnpm exec playwright test -c playwright.guide.config.ts --list`;
      Expected: the one test listed.
- [ ] Ask the operator, then run `E2E_CLEANUP=1 pnpm guide:screenshots`; Expected: pass, the
      Event deleted, the five PNGs written; look at each PNG for real people.
- [ ] Insert the images: desk and gear on `staff-referees.md` (beside "The other tabs"), the
      scoreboard and wall on `venue-screens.md`, the match page on `when-things-go-wrong.md`.
- [ ] Tests PASS; reprint both sheets (unchanged: 1 page). Commit
      `docs(guide): screenshots of the desk, gear, venue screens and match page`.

### Finish

Final whole-branch review by a fresh reviewer; gates (`myclash-gates`); move the spec to
`docs/superpowers/archive/specs/` and delete this plan in the closing commit; push; update the
memory note `project_organiser_guide_1118.md`.
