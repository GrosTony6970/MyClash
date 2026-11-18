# Guide Part 2 (Concepts and Scoring Pad) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two sections to the organiser guide (five "Understand MyClash" pages and two
"Scoring pad" pages, FR + EN), with a contents list grouped by section, a printable scorekeeper
sheet, and about 10 more screenshots.

**Architecture:** The existing collection gains a `section` field; `Guide.astro` groups the
contents list by it; `order` keeps one reading order across the whole guide. Content pages are
Markdown like part 1. The screenshot script gains new shots and links imports to the invented
profiles earlier runs made.

**Tech Stack:** Astro 7 content collections, node:test over `dist/`, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-guide-concepts-and-pad-design.md` (and part 1,
`docs/superpowers/archive/specs/2026-11-18-organiser-guide-design.md`).

## Global Constraints

- Every page in FR and EN, same slug, same `order`, same `section` (hard rule 6).
- No real person in any screenshot (hard rule 7). Screenshots are English only.
- Every bold label is copied from `packages/i18n/src/messages/{en,fr}`; check with the label
  script (`check-labels.mjs`, recreated in the workspace from part 1's: it lists bold labels not
  found in that locale's i18n files).
- Every factual claim (what is automatic, what is locked, what needs the network, who may do
  what) is checked against the code, with the file:line noted in the task's ledger line.
- The screenshot Event is `eventKind: 'test'`, never published, deleted in `finally`. Ask the
  operator before each run on the deployed stack.
- **A repo doc that disagrees with the code gets corrected to match the code** (operator,
  2026-11-18): CLAUDE.md, ARCHITECTURE.md, ADRs, READMEs, specs. One commit per correction, the
  code reference in the message. Never change the code to match a doc in this slice.
- No new dependency. One concern per commit; commit messages lower-case after the scope
  (commitlint `subject-case`).
- `myclash-gates` before the push.

## Review Focus

1. **A section that differs between languages** (a page under "Concepts" in FR, "Pad" in EN):
   the parity test compares `section` as well as `order` (Task 1).
2. **The printed sheet carries the site chrome or runs to two pages**: the print stylesheet hides
   nav, footer, contents and next link (test in Task 1); the one-page fit is checked by a print
   preview in Task 5.
3. **A claim in "What is automatic" that the code does not do**: each item cites the code
   (Task 3, ledger).
4. **A pad control described for a state where it is hidden** (e.g. Reset while the clock runs):
   the reference is organised by clock state, from the pad's own components (Task 5).
5. **A re-run that links an invented row to a real profile**: the script links only when every
   suggested match is one of the roster's own names, else it creates new (Task 2).

---

### Task 1: Sections in the contents list, and the print stylesheet

**Files:**

- Modify: `apps/web-marketing/src/content.config.ts` (schema)
- Modify: `apps/web-marketing/src/layouts/Guide.astro` (grouped contents)
- Modify: `apps/web-marketing/src/styles/guide.css` (section headings, `@media print`)
- Modify: `apps/web-marketing/src/i18n/ui.ts` (three section labels)
- Modify: all 22 existing `src/content/guide/{fr,en}/*.md` (add `section: steps`)
- Test: `apps/web-marketing/test/guide.test.mjs`

**Interfaces:**

- Produces: frontmatter `section: 'steps' | 'concepts' | 'pad'` (zod enum, required).
  Orders: steps 0–10 (unchanged), concepts 11–15, pad 16–17.
- Produces: `CHROME` keys `guideSectionSteps`, `guideSectionConcepts`, `guideSectionPad`.
  FR `'Pas à pas'`, `'Comprendre MyClash'`, `'Tablette de score'`;
  EN `'Step by step'`, `'Understand MyClash'`, `'Scoring pad'`.
- Produces: in both contents lists, one `<p class="guide-toc__section">` heading per section that
  has pages, in the order steps → concepts → pad, each followed by its `<ol>`.

- [ ] **Step 1: Failing tests** in `guide.test.mjs`:
  - extend the order-parity test into `a guide page has the same order and section in both
languages` (read `section:` too; compare `{order, section}` per file);
  - `the contents list groups pages by section, in reading order`: on `/guide` and `/en/guide`,
    the `.guide-toc--wide` block has `guide-toc__section` headings whose texts equal the CHROME
    labels of the sections present, in steps → concepts → pad order;
  - `printing a guide page hides the site chrome`: the bundled CSS linked by `/guide` contains,
    whitespace-stripped, an `@media print` block hiding `.nav`, `.footer`, `.guide-toc` and
    `.guide-next` (`display:none`).
- [ ] **Step 2: Run** `pnpm --filter @myclash/web-marketing test`. Expected: the three new
      tests FAIL (no `section`, no headings, no print rule).
- [ ] **Step 3: Implement.** Schema field; CHROME keys; `Guide.astro` builds
      `sections = [{ key, label, items }]` from `pages` (already sorted by `order`), skipping empty
      sections; `guide.css` styles `.guide-toc__section` like `.guide-toc__title` and adds the
      `@media print` block (also: body text black on white, images `break-inside: avoid`). Add
      `section: steps` to the 22 existing pages.
- [ ] **Step 4: Run** the tests. Expected: PASS, 20 tests (18 before; the parity test is
      extended, two are new).
- [ ] **Step 5: Show each new test red** once (a page with a different `section` in EN; the
      headings removed; the print block removed), restore, re-run green.
- [ ] **Step 6: Commit** `feat(marketing): the guide's contents are grouped by section, and a
page prints clean`.

### Task 2: The screenshot script, part 2

**Files:**

- Modify: `tests/guide/screenshots.spec.ts`
- Create: `apps/web-marketing/src/assets/guide/1x-*.png` (output)
- Modify: `tests/e2e/README.md` (the guide section: link-all behaviour, new shots)

**Interfaces:**

- Produces these PNGs (Tasks 3–5 reference them as `../../../assets/guide/<name>.png`):

| File                     | Screen                                                               |
| ------------------------ | -------------------------------------------------------------------- |
| `11-rulesets.png`        | the organisation's **Rulesets** page                                 |
| `11-ruleset-new.png`     | the new scoring ruleset form (`rulesets/scoring/new`), not submitted |
| `11-org-members.png`     | organisation **Org Members** page (`settings`)                       |
| `12-double-elim.png`     | a played double-elimination bracket                                  |
| `12-swiss.png`           | a Swiss tournament after its first round                             |
| `13-pad-running.png`     | tablet, clock running, a few exchanges entered                       |
| `13-pad-penalties.png`   | tablet, the penalty search open or a card given                      |
| `13-pad-corrections.png` | tablet, **Match actions** drawer open                                |
| `13-pad-offline.png`     | tablet with the network cut: the grey OFFLINE bar, one hit queued    |
| `13-pad-ended.png`       | tablet after **End match**: the ended state with **Re-open match**   |

- [ ] **Step 1: Link instead of duplicating.** On the import preview, click **Link all
      suggested** when it is enabled AND the expanded **Duplicates** list names only people of
      `guide-roster.csv`; otherwise click **Create all as new**. Take `03-import-preview.png` after.
- [ ] **Step 2: Add the shots** in the table. Sources to copy from: the pad's buttons and states
      in `tests/e2e/16-pad-ui.spec.ts` (`cleanHit`, clock status, `network-bar`); Swiss in
      `tests/e2e/_swiss.ts` and `22-swiss.spec.ts`; double elim via `playTournamentToChampion`
      (`tests/e2e/_tournament.ts`) with 8 of the roster's fighters. Offline: `context.setOffline(true)`
      on the tablet page, press one clean hit, shoot, then `setOffline(false)` and wait for
      `data-network="online"`. Every new tournament lives in the same test Event.
- [ ] **Step 3: Type-check** with the strict `tsc` command of part 1 and
      `npx playwright test --list -c playwright.guide.config.ts` (1 test) and
      `-c playwright.config.ts` (0 guide tests). Expected: clean.
- [ ] **Step 4: Ask the operator, then run** `E2E_CLEANUP=1 pnpm guide:screenshots`.
      Expected: 1 passed, 26 PNGs, Event deleted, the import preview says "will link".
- [ ] **Step 5: Look at every new PNG** (English, no real person, nothing mid-load).
- [ ] **Step 6: Commit** `test(guide): the screenshot script links to its own profiles and
shoots the pad, the formats and the rulesets`.

### Task 3: Understand MyClash: how it works, formats, what is automatic

**Files:** Create `src/content/guide/{fr,en}/how-myclash-works.md` (order 11),
`formats.md` (12), `automation.md` (13), all `section: concepts`.

- [ ] **Step 1: Research** (one Explore agent, report under 900 words with file:line):
      vocabulary from `docs/HIERARCHY.md`; the three apps and who sees what (`isPublicEvent`,
      tournament status gate); how a score is derived (`@myclash/rulesets`, the pad's provisional
      score, offline sync); each format's generation and options (pools, `single_elim`,
      `double_elim` with bronze / second chance / repechage, Swiss pairing and rounds); every
      automatic behaviour (pool draw constraints, programme suggest/generate, referee auto-assign and
      its rules, bracket auto-populate, winner advancement, standings, notifications, start-of-day,
      auto-lock) and what stays manual.
- [ ] **Step 2: Write the EN pages**, then **Step 3: the FR pages**. Images: `12-double-elim`,
      `12-swiss`, `04-pools`, `08-bracket` where they help.
- [ ] **Step 4: Label script** (only prose flagged) and **site tests** (PASS).
- [ ] **Step 5: Commit** `docs(guide): how myclash works, its formats, and what it does by itself`.

### Task 4: Understand MyClash: rulesets and staff access

**Files:** Create `{fr,en}/rulesets.md` (order 14), `staff-access.md` (15), `section: concepts`.

- [ ] **Step 1: Research** (Explore agent): the Rulesets screens (`rulesets`, `rulesets/scoring/new`,
      `/edit`, `rulesets/penalty`), the built-in rulesets, what a custom ruleset can set, the formula
      editor (no code execution: Zod AST, hard rule 5), any review step; organisation member roles
      and what each may do (`assertOrgRole` levels), inviting a member (`settings`), event staff
      account roles, PIN rules, lice assignment, the staff sign-in link, disable vs delete.
- [ ] **Step 2–3: EN then FR pages.** Images `11-rulesets`, `11-ruleset-new`,
      `11-org-members`, `06-staff`.
- [ ] **Step 4: Label script + site tests.**
- [ ] **Step 5: Commit** `docs(guide): rulesets and who gets access to what`.

### Task 5: Scoring pad: the scorekeeper sheet and the reference

**Files:** Create `{fr,en}/scorekeeper-sheet.md` (order 16), `pad-reference.md` (17),
`section: pad`. The last page is now `pad-reference` (no next link).

- [ ] **Step 1: Research** (Explore agent): from `apps/web-staff` components (ScoringCenterControls,
      ScoringColumn, MatchHeader, MatchCorrectionsDrawer, SyncBar, end-guard, ResetMatchZone) and
      `packages/i18n/.../scoring.ts`: every control, the clock states in which it shows or is
      enabled, keyboard shortcuts, penalties and cards, protests (the protest limit), corrections,
      reset and reopen (who may), best-of rounds, extra time and sudden death, what is queued offline
      and what needs the network, locks.
- [ ] **Step 2: The sheet (EN, FR)**: one A4 page when printed: sign in, open a bout, start and
      pause, score, double and no exchange, undo, a card, end the bout, the wifi drops, who to call.
      No more than two small images.
- [ ] **Step 3: The reference (EN, FR)**, organised by clock state (idle, running, paused,
      ended), then penalties and protests, corrections, rounds and extra time, offline, locks.
      Images: the `13-pad-*` set.
- [ ] **Step 4: Print preview** of `/guide/scorekeeper-sheet` and `/en/guide/scorekeeper-sheet`
      (Playwright `page.pdf({ format: 'A4' })` into the scratchpad): one page each, no nav, footer or
      contents.
- [ ] **Step 5: Label script + site tests.**
- [ ] **Step 6: Commit** `docs(guide): a printable scorekeeper sheet and the full pad reference`.

### Task 6: Close

- [ ] **Step 1:** Update the index pages (FR, EN) to list the two new sections.
- [ ] **Step 2:** Final whole-slice review (fresh reviewer); fix Critical/Important with a test.
- [ ] **Step 3:** `myclash-gates` chain green.
- [ ] **Step 4:** Move the spec to `docs/superpowers/archive/specs/`, delete this plan, update
      the memory note; commit `docs(guide): part 2 shipped; its spec moves to the archive`.
- [ ] **Step 5:** `git fetch`, check `origin/main`, push.
