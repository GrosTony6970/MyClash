# Organiser guide — design

Status: approved by the operator on 2026-11-18. Not built yet.

## Context — intent and the why

MyClash is about to open to a **small group of test organisers**. They will be on their own, not
next to the operator. Today there is **no user documentation at all**: `docs/` is developer-only,
and the only organiser-facing help is in-app tooltips (`HelpTooltip`, `StatusHelp`,
`rulesetHelp.ts`, `columnHelp.ts`).

The guide lets a new organiser go from a fresh account to an Event that ran and published its
results, without messaging the operator. Success: testers' questions are about HEMA, not about
where a button is.

## Goals

- A task-ordered walkthrough of the **full journey**: create the Event → publish results.
- French and English, French as the default (the site's convention).
- Screenshots made by a script from an invented practice Event, **English only** (operator call).
  The French pages show the English screenshots.
- It stays the permanent guide after the test phase.

## Non-goals (v1)

Workshops, AI assistant / chatbot / generated content, Leagues, compensation, photos,
notifications, Swiss, print pack, debrief, theme. Each can get its own page later. No in-app links
from the admin app to the guide (follow-up; see "Calls I made").

## Anti-goals

- **A screenshot that shows a real fighter.** The repo is public (hard rule 7). The screenshot
  roster is invented. The E2E account and club in the admin sidebar are allowed, by operator ruling. `tests/e2e/fixtures/participants.sample.csv` holds at least one real HEMA
  name ("Guy Windsor"), so **don't reuse it**. Write a new invented roster.
- **A guide that describes the app wrongly.** Each step is drafted from the real screen and code,
  then checked by the operator on the test stack.
- **A new docs framework.** No Starlight, no new dependency.

## Approaches considered

1. **Guide pages on myclash.fr (Astro, Markdown), chosen.** It reuses the bilingual setup that
   already works in `apps/web-marketing` (FR at `/`, EN at `/en`, typed `CHROME` strings in
   `src/i18n/ui.ts`, `Base.astro` layout). It ships with the regular redeploy and stays as the
   permanent guide. Cost: every fix takes a commit and a redeploy, and testers can't comment on
   the page.
   - Variant rejected: **Starlight**. It is a new dependency with its own look, which would need
     restyling to "Tournament Manual". It isn't worth it for about 10 pages.
2. Markdown in the repo, read on GitHub. Rejected: testers are organisers, not developers, and
   would land on a page of source code.
3. A shared doc (Claude Docs / Google Doc). Rejected: it lives outside the repo, drifts from the
   app, and would be rewritten as option 1 later.

## Design

### Pages

| #   | Slug (`/guide/…`, `/en/guide/…`) | Covers                                                                                                                                                                                                                                             | Admin route(s) it describes                                        |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| —   | `/guide` (index)                 | What the guide is, the table of contents                                                                                                                                                                                                           | —                                                                  |
| 0   | before-you-start                 | **Self sign-up** (operator ruling): sign up → create your club → wait for the platform admin to approve it (the club is created `pending_approval`, `organizations.controller.ts` `POST /organizations`); then the 3 Event kinds and which to pick | `signup`, `dashboard`, `events/new` (kind field)                   |
| 1   | create-event                     | Name, dates, venue, pistes                                                                                                                                                                                                                         | `events/new`, `venues`                                             |
| 2   | add-tournament                   | Weapon, format, ruleset                                                                                                                                                                                                                            | `tournaments/new`, `tournaments/[id]/settings`, `rulesets/scoring` |
| 3   | register-fighters                | Add one by one, CSV import, registrations                                                                                                                                                                                                          | `persons`, `persons/import`, `registrations`                       |
| 4   | pools                            | Generate, adjust, publish                                                                                                                                                                                                                          | `pools`                                                            |
| 5   | schedule                         | Build the schedule                                                                                                                                                                                                                                 | `schedule`                                                         |
| 6   | staff-referees                   | Invite scorekeepers and referees, qualifications, assignments                                                                                                                                                                                      | `staff`, `referees`, `referee-assignments`                         |
| 7   | event-day                        | Scoring pad on tablets (web-staff), live view, offline behaviour                                                                                                                                                                                   | `live`, `day`, web-staff pad                                       |
| 8   | bracket                          | Elimination bracket                                                                                                                                                                                                                                | `bracket`                                                          |
| 9   | results                          | Final ranking, publish, HEMA Ratings export (Standard only)                                                                                                                                                                                        | `finalranking`, `hema-ratings`                                     |

**Slugs are the same in both languages** (e.g. `/guide/pools` and `/en/guide/pools`). `Base.astro`,
`LangSwitch.astro` and the sitemap pair the two languages by sharing one path, and localized slugs
would mean changing that layout, which every page uses. The builder picks the exact words.

**Page anatomy:** title → one line "What you'll do" → numbered steps naming the exact button labels
(as they appear in that locale's UI, taken from `packages/i18n/src/messages/{en,fr}`) →
screenshots → a "⚠ Hard to undo" callout where one applies → "Next step" link. A side table of
contents on desktop collapses on phone.

**Page 0 content (already ruled):** the Event kind table from `packages/types/src/event-kind.ts`:

| Kind     | Public sees it            | Counts in rankings / career / Leagues | HEMA Ratings | Followers notified | Deletable with results |
| -------- | ------------------------- | ------------------------------------- | ------------ | ------------------ | ---------------------- |
| Standard | yes, once published       | yes                                   | yes          | yes                | no                     |
| Test     | never (club members only) | no                                    | no           | no                 | yes                    |
| Club     | yes, once published       | no (own results pages only)           | no           | no                 | yes                    |

Plus: a Draft is hidden from the public whatever its kind. Advice: try things in a **Test**
Event; run a real competition in a **new Standard** Event (don't convert the test one, because its
practice data comes with it); use **Club** for club nights and gradings.

### Where the code goes (`apps/web-marketing`)

- Markdown content: an Astro content collection (built into Astro 7, no new dependency), one file
  per page per locale, e.g. `src/content/guide/fr/*.md` and `src/content/guide/en/*.md`, with
  frontmatter `order`, `title`, `slug`.
- Routes: `src/pages/guide/[...slug].astro` and `src/pages/en/guide/[...slug].astro`, both
  rendering through one shared `Guide.astro` layout built on `Base.astro` (one owner).
- Shared chrome strings ("Next step", "Contents", "Hard to undo", the nav label "Guide") go in
  `CHROME` in `src/i18n/ui.ts`, so a missing translation is a type error.
- A "Guide" link in the site nav (`Nav.astro`) and footer.
- Styling uses the site's existing stylesheet and tokens; no raw colours.

### Screenshot script

- Its own Playwright config (e.g. `playwright.guide.config.ts`) and a spec under `tests/guide/`.
  It targets the deployed stack like `playwright.e2e.config.ts`, and reuses its login and helpers
  (`tests/e2e/_api.ts`, `_tournament.ts`, `_pool.ts`, `_pad.ts`).
- It creates **one Event with `event_kind: 'test'`** (never public), fills it with an **invented
  roster** committed as `tests/guide/fixtures/guide-roster.csv`, walks steps 1–9, and saves PNGs to
  `apps/web-marketing/src/assets/guide/<step>-<name>.png`. Then it deletes the Event.
- English UI, fixed desktop viewport; the scoring-pad shots use a tablet viewport.
- **Account in the shots (operator ruling): the E2E account and club, as they are.** Their name,
  email and other Events may appear in the admin sidebar. No masking.
- **Page 0 sign-up shots:** the script captures the sign-up form and the club-creation form
  _without submitting_. That way it creates no account and no club. The "waiting for approval"
  state is described in text only.
- **Page 9, HEMA Ratings:** the export refuses Test Events (`exports.service.ts:78`), and the script
  must not publish a Standard Event, because that would announce it to the club's real followers.
  So this step gets **no screenshot**. The text explains the export and says plainly that Test and
  Club Events cannot use it.
- **Run on demand by the operator** (it needs `.env.e2e` credentials and writes data). Not a CI job.
  Re-run when a screen changes; the PNGs are committed.

### Tests (hard rule 10)

Extend `apps/web-marketing/test/site.test.mjs` (it runs over the built `dist/`):

- every guide page exists in **both** locales (FR/EN parity, same set of `order` values);
- every image a guide page references exists in `dist/`;
- every "Next step" link resolves to a built page;
- guide pages appear in the sitemap.

Each assertion must be shown to go red (delete one EN file, break one image path) before it counts.

## Constraints

- Hard rule 6: every user-facing string is in FR and EN. Page bodies are per-locale Markdown (the
  site's existing rule: "page body copy stays in its own .astro file"), and shared chrome goes in
  typed `CHROME`.
- Hard rule 7: no real names, emails or rosters anywhere, screenshots included.
- Hard rule 9: one slice = one commit, for example: (a) the guide skeleton plus the tests,
  (b) the screenshot script plus the PNGs, (c) the content. The builder decides the split.
- `myclash-gates` chain green before each push; the marketing site's `test` builds `dist/`.

## Left to the builder

The exact slugs and wording, the Markdown frontmatter shape, the side-nav markup, the screenshot
list per page, image sizes/formats (through Astro's image pipeline), and the commit split.

## Calls I made (for the operator to check)

- v1 scope stops at the 10 pages above; the left-out areas are listed under Non-goals.
- No "Guide" link inside the admin app for v1. Testers get the URL directly, and the
  marketing nav links to it. An in-app link per screen is a follow-up.
- The screenshot script is operator-run, not CI.
- Same slug in both languages (it keeps the shared layout and the language switch as they are).
- No screenshot of the HEMA Ratings export; the sign-up shots stop before submitting.
- [docs/ARCHITECTURE.md:517](docs/ARCHITECTURE.md#L517) wrongly says club Events are excluded
  from public listings (the code makes them public). This gets fixed in its own separate commit,
  not in this slice.

## Verification

1. `pnpm --filter @myclash/web-marketing test` is green: build, plus the parity, image, link and
   sitemap assertions; each is shown going red once.
2. `pnpm --filter @myclash/web-marketing dev`, then open `/guide` and `/en/guide` at desktop
   and at 400px; walk every "Next step" link.
3. Run the screenshot script against the test stack. The PNGs appear, the test Event is gone
   afterwards, and no screenshot shows a real name.
4. The operator walks the guide on a fresh Test Event on their stack and flags each mismatch.
5. The `myclash-gates` chain is green, then push.
