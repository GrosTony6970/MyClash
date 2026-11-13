# FightBook named fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three items the FightBook slices named and left: every refusal the database gives a
FightBook action answers a sentence, not a bare word; "My FightBook QR" never has two code requests
out at once; the dead weapon-catalog seeder goes.

**Architecture:** No migration, no new route, no new table. Task 1 is the API's one translator of
database refusals (`databaseRefusal`, `spar-requests.service.ts`). Task 2 is the web hook that
mints the QR code (`use-qr-code.ts`). Task 3 deletes an uncalled method from `fighters.service.ts`.

**Tech Stack:** NestJS, Next 16 / React 19, Vitest (jsdom for the hook).

**Spec / rulings** (2026-11-13, `C:\Users\Tony\.claude\plans\fightbook-handoff.md`):

- **752** The next FightBook item is the three named fixes: the QR double mint on wake (slice 5's
  Ruling U), take-back's bare `not_open` (Ruling V), the dead `seedDefaultWeapons`.
- **753** The bare-word fix covers EVERY word the database raises, not only take-back's: one list
  gives each `SparRefusalCode` one sentence, and the typecheck fails when a new word has none.
- **754** A wake (or an opening) while a code request is out sends no second request; it waits for
  the one out. A request with no answer after 10 seconds counts as failed: the panel says the code
  could not be made and shows "Try again"; its late answer is dropped.
- (751 is state, not work: the prod offline E2E is still owed; the operator has not redeployed.)

## In plain words

1. Sam reads the raw API after a refused take-back and sees "This request is no longer open", not
   `not_open`. The same for every FightBook refusal the database decides. The web page does not
   change: it already reads the `code` and shows its own translated sentence.
2. Sam opens "My FightBook QR", locks the phone before the code arrives, and unlocks it. The phone
   asks the server once, not twice, so the 60-an-hour budget loses nothing. If that one request is
   lost (the wifi dropped in the sleep), after 10 seconds Sam sees "could not be made" and a
   "Try again" button instead of an empty panel forever.
3. Nobody sees fix 3. A method that could write the weapon catalog, and that nothing calls, is
   removed (ruling 695: only admins add catalog weapons).

## Global Constraints

- One task = one commit, Conventional Commits, subject lowercase after the scope.
- No user-facing string changes: the API sentences are the problem+json `message`/`detail`, which
  the web never shows (it keys on `code`, `sparRefusalKey`). Hard rule 6 is about what a person sees;
  the API's English messages are the existing convention (`refusal('no_profile', 'FightBook needs a
fighter profile')`).
- A sentence is a fixed string: no name, no count, no id. It says nothing the `code` does not already
  say (ruling 672: a face only a block can produce is a leak; the code is already that face, the
  sentence adds none).
- Status codes do not change (`refusalStatus` stays the one owner of word → status).
- Complexity: `pnpm quality:complexity` after prettier, before every commit. Test files count toward
  the 400-line cap (`QrPanel.test.tsx` is 221, `QrPanel.gaps.test.tsx` 128).
- After every subagent: `git status --short` and `git stash list`.
- Another session commits here: before staging, `git fetch`, `git log --oneline -1`, `git status
--short`; stage explicit paths; `git diff --cached --stat`. Before pushing, `git log
origin/main..HEAD` holds only this plan's commits.

## Decisions taken in this plan

- **D1 Where the sentences live.** A `const SPAR_REFUSAL_SENTENCES: Record<SparRefusalCode, string>`
  in a new leaf file `apps/api/src/modules/fightbook/spar-refusal-sentences.ts` (imports only the
  type). A leaf, because `spar-requests.service.ts:19` already imports `spar-side.ts`, so D2 reading
  the list from the service would be an import cycle. `Record<SparRefusalCode, …>` makes a new word
  in `SPAR_REFUSAL_CODES` a typecheck error until it has a sentence. Not in `@myclash/types`: the
  web owns its own (translated) sentences and must not ship these.
- **D2 One owner of the `not_open` sentence.** `notOpen()` (`spar-side.ts`) uses
  `SPAR_REFUSAL_SENTENCES.not_open` instead of its own literal. The text stays
  `'This request is no longer open'`, so the agreed-spar routes answer exactly what they answer
  today. `databaseRefusal` (`spar-requests.service.ts:85`) reads the same list.
- **D3 Wording.** The API sentences follow the web's English (`publicApp.fightBook.refusal`, EN)
  without the trailing period and without the `{max}` placeholder: `favourites_full` reads
  `'Your favourites list is full'`. Every other word: the EN sentence minus its period.
- **D4 A word outside the list** (a database word no `SparRefusalCode` names) keeps today's path:
  403 with the word as its message. That is the only text there is. "Known" is decided by
  `SPAR_REFUSAL_CODES.includes(word)`, never by indexing the list (`'toString'` would index a
  function).
- **D5 The API's own checks keep their own sentences** (`badRequest('bad_event', 'Spars can name
only…')`): they say more about their own context. D1's list is for the database's words only.
- **D6 The QR invariant.** At most one mint request is out at a time. A wake, a renewal timer, or a
  re-opening while one is out sends nothing: the mint in flight is owned by a ref that outlives effect
  re-runs, not by the effect's `cancelled` flag. A new mint starts only when no mint is out, or when
  the one out has been given up at 10 s. **The 10 s timer belongs to the in-flight record too** (in
  the ref, cleared only when that mint answers or is given up), never to an effect's cleanup: a wake,
  a close or StrictMode's double run re-runs the effect, and a timer the cleanup clears is never
  armed again (cold review finding 1). Every give-up (timer, wake, opening) clears that mint's
  timer: that is the timer's one guard. **Each mint carries an id**; its answer acts only if the ref
  still holds that id, so an abandoned mint's late answer neither shows its code nor clears the newer
  mint's record. "Try again" only shows after a failure. A mint given up at
  10 s may still be on the wire when "Try again" sends the next: ruling 754 counts it as failed, so
  this is accepted (at most one extra code, only after a 10 s silence).
- **D7 The 10 s limit on both clocks.** A `setTimeout` of 10 s gives the mint up while the phone is
  awake. Timers stop while a phone sleeps (ENGINEERING lesson, slice 6), so a wake also checks the
  wall clock: a mint out for 10 s or more by `Date.now()` is given up at that wake. At an opening
  (the wake listener exists only while the panel is open) such a mint is DROPPED instead: the ref
  is cleared, no failure is set (its failure belonged to the time the panel was closed, D8, and the
  opening clears failures during render, `use-qr-code.ts:65-68`), and the opening mints. Giving up
  at a wake or by the timer = `failure: 'failed'`
  AND `setHeld(null)`, as a failed answer does today (`use-qr-code.ts:92`): a renewal given up
  while its old code is still held must not leave that code on screen, because the panel shows a
  code before a failure (`QrPanel.tsx:19-23`). The late answer is dropped (no code shown from it).
- **D8 Closing the panel** while a mint is out does not give it up: its answer is kept as the held
  code (the held code already outlives the panel, so a re-opening reuses it and mints nothing). The
  10 s limit runs whether the panel is open or closed. A failure still belongs to the opening it
  happened in (cleared on the next opening, as today), so a mint given up while closed is retried by
  the next opening. A mint that answers 401 after the panel closed sends nobody to sign in (the
  panel is gone); the next opening mints, and its 401 sends them.
- **D9 The web never shows the API's message** for FightBook: `writeFightBook` answers `code` and
  `status` only (`apps/web-public/src/lib/fightbook/read-fightbook.ts:206`), and no FightBook screen
  reads `.message` or `.detail` (grep of `app/me/fightbook`, `src/lib/fightbook`, non-test). So Task 1
  changes no screen and no i18n key.

## Review Focus

- Task 2 is a race between four writers: the mint's answer, the 10 s timer, a wake, and an
  opening/closing. Say for each test which of them it orders.
- Task 1: the 8 callers of `databaseRefusal` (blocks, take-back, pick, review, flag, QR log, ask,
  answer) — each answers its word's sentence with an unchanged status.

## File map

| File                                                             | Task | Change                                                       |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------------ |
| `apps/api/src/modules/fightbook/spar-refusal-sentences.ts` (new) | 1    | the sentence list (D1)                                       |
| `apps/api/src/modules/fightbook/spar-requests.service.ts`        | 1    | `databaseRefusal` uses the list                              |
| `apps/api/src/modules/fightbook/spar-side.ts`                    | 1    | `notOpen()` reads the list                                   |
| `apps/api/src/modules/fightbook/spar-refusal.test.ts` (new)      | 1    | every word: code, status, sentence                           |
| `apps/api/src/modules/fightbook/open-calls.*.test.ts`            | 1    | the take-back 409 answers the sentence                       |
| `apps/web-public/app/me/fightbook/use-qr-code.ts`                | 2    | one mint out; 10 s limit on both clocks                      |
| `apps/web-public/app/me/fightbook/QrPanel.flight.test.tsx` (new) | 2    | B1-B12                                                       |
| `apps/web-public/app/me/fightbook/QrPanel.gaps.test.tsx`         | 2    | delete "Two mints that overlap"; rewrite the header (:12-16) |
| `apps/api/src/modules/fighters/fighters.service.ts`              | 3    | delete `seedDefaultWeapons` and `DEFAULT_WEAPONS`            |
| `docs/ARCHITECTURE.md` §11septies                                | 1, 2 | one sentence each                                            |
| `docs/code-quality-complexity-baseline.json`                     | 1-3  | re-pointed only where an edited file needs it                |

### Task 1: Every database refusal answers a sentence

- [ ] Write `spar-refusal.test.ts` first (red): for EVERY word of `SPAR_REFUSAL_CODES`,
      `databaseRefusal({ code: 'P0001', message: word }, 'x')` is an `HttpException` whose response has
      `code === word`, a status equal to today's (`409` for `already_asked`, `not_again`, `not_open`,
      `favourites_full`; `400` for the ten `bad_*`/`self`/`too_many_calls`; `403` for `no_profile`,
      `fightbook_off`, `not_on_fightbook`, `you_blocked` — write the table out, do not derive it from
      `refusalStatus`), and a message equal to that word's sentence, written out in the test (D3), so
      two words' sentences swapped turns it red. Plus: a word
      no code names (`'mystery'`) answers 403 with message `'mystery'` (D4); a non-P0001 error is a plain
      `Error`, not an `HttpException`. Plus: `notOpen()`'s message equals the list's `not_open` (D2).
- [ ] Add the list (D1, D3) and route `databaseRefusal` through it for 409, 400 and 403. `notOpen()`
      reads it (D2).
- [ ] Take-back at the service: extend the existing take-back test so a `P0001 not_open` refusal
      answers 409 with message `'This request is no longer open'` (one route of the 8 proved end to end
      at the service; the unit test covers the word list).
- [ ] Grep the API tests for a pinned bare-word message (`message: 'not_open'` as an ASSERTED
      response, not as a mocked database error) and update only those.
- [ ] ARCHITECTURE §11septies, "Refusal words and status codes": one sentence — the database's
      words answer one fixed English sentence each (`SPAR_REFUSAL_SENTENCES`), the web shows its own.
- [ ] `pnpm --filter @myclash/api test -- fightbook`, typecheck, lint, prettier, complexity. Commit
      `fix(fightbook): every database refusal answers a sentence, not its bare word`.

### Task 2: "My FightBook QR" never has two code requests out

Behaviours, each a test (fake timers; `apiRequest` mocked with held promises, as the gaps test):

- [ ] **B1** Open → the mint is out (no answer yet) → wake. `apiRequest` was called ONCE. Answer it:
      its code shows. (This REPLACES "Two mints that overlap", which pinned the double mint as intended;
      delete that test and say so in the commit body.)
- [ ] **B2** A code shown → 6 minutes pass on the wall clock with `performance.now` frozen → wake
      with the renewal's mint held unanswered → the dead code leaves the screen at once (the existing
      "takes the dead code off the screen" stays green) AND a second wake sends no further request
      (`apiRequest` count unchanged).
- [ ] **B3** Open → the mint never answers → 10 s pass (timers run) → the alert says the code could
      not be made and "Try again" shows. Then the late answer arrives → no code shows. Tap "Try again" →
      exactly one new request.
- [ ] **B4** Open → the mint out → the phone sleeps: `performance.now` frozen, timers NOT advanced,
      `setSystemTime(+60 s)` → wake → the failure shows at once and no new request was sent (D7).
- [ ] **B5** Open → the mint out → close the panel → open again before the answer: no second
      request; answer it → its code shows (D8).
- [ ] **B6** The mint answers at 9.9 s: its code shows, no failure, and the 10 s timer firing later
      changes nothing (bracket: advance 9_900, answer, advance 1_000).
- [ ] **B7** Open → the mint out → wake (no new request) → 10 s pass → the alert shows (the timer
      survives an effect re-run, D6).
- [ ] **B8** Open → the mint out → close → 10 s pass → open → exactly one new request (given up
      while closed; the failure is cleared by the opening, D8).
- [ ] **B9** A code shown → 4 min 30 s pass (the renewal's mint out, held unanswered) → 10 s pass →
      no code shows and the alert shows (D7: giving up clears the held code).
- [ ] **B10** Open → 10 s pass (given up) → tap "Try again" (request 2 out) → request 1's answer
      arrives → no code shows; wake → still 2 requests in all; answer request 2 → its code shows.
- [ ] **B10b** (request 1's timer still pending) B4's setup: the wake gives request 1 up by the
      wall clock, its `setTimeout` not yet fired → advance 5_000 → tap "Try again" (request 2 out) →
      advance 6_000 (request 1's timer fires inside it) → no alert; answer request 2 → its code shows.
- [ ] **B11** Open → the mint out → close → it answers 401 → `signInAgainHere` not called (D8).
- [ ] **B12** Open → the mint out → close → the phone sleeps (`performance.now` frozen, timers NOT
      advanced, `setSystemTime(+60 s)`) → open → exactly one new request at once (D7's check at an
      opening; the opening clears the failure, so it mints, as in B8).
- [ ] Run B1-B12 on today's hook first and record each colour. Expected red: B1-B5, B7, B9, B10,
      B10b. Expected green today: B6 (it answers in time), B8, B11, B12 (today a close drops the mint, so
      the opening mints once and a late 401 is ignored) — they pin that the change keeps it so.
- [ ] Implement D6-D8 in `use-qr-code.ts`. Keep the doc comment's "Two writers are named" paragraph
      true: rewrite it to name the four writers and how each is handled.
- [ ] Every existing `QrPanel.test.tsx` and `QrPanel.gaps.test.tsx` case stays green unchanged (except
      the one B1 replaces).
- [ ] ARCHITECTURE §11septies, the QR paragraph: one sentence — one mint out at a time; a mint with
      no answer after 10 s (either clock) counts as failed (ruling 754).
- [ ] `pnpm --filter web-public test -- QrPanel`, typecheck, lint, prettier, complexity. Commit
      `fix(fightbook): the QR panel never has two code requests out at once`.

### Task 3: Remove the dead catalog seeder

- [ ] `grep -rn "seedDefaultWeapons\|DEFAULT_WEAPONS" apps packages` (excluding `dist`,
      `node_modules`) shows only `fighters.service.ts`. Delete the method and the now-orphan constant.
      `slugify` stays (other callers).
- [ ] Typecheck, lint, the fighters tests, complexity. The baseline WILL re-point: it keys
      `fighters.service.ts`'s functions by line (`docs/code-quality-complexity-baseline.json` ~:277-283),
      and both deletions sit above them. `--write-baseline`, then `baseline-audit.mjs` must print
      `per-file changes: 0` (only line moves). Commit
      `refactor(fighters): drop the uncalled weapon-catalog seeder`.

### Task 4: Falsify, gates, review, push

- [ ] Code falsifier (copy `falsify-fb6.mjs`, new cases only): F1 `databaseRefusal` answers the
      word as message → Task 1's test red; F2 `notOpen()` back to its own literal with other text → red;
      F3 the hook starts a mint on wake while one is out → B1 red; F4 the 10 s timer removed → B3 red;
      F5 the wake's wall-clock check removed → B4 red; F6 closing gives the mint up → B5 red; F7 the
      timer cleared by the effect cleanup → B7 red; F8 giving up keeps `held` → B9 red; F9 the answer's
      id check removed → B10 red; F10 the opening's wall-clock check removed → B12 red; F11 a give-up
      leaves the mint's timer running → B10b red.
- [ ] The 32 gates (`gates.sh`), local gitleaks, cold whole-slice review (`code-architecture-reviewer`,
      Opus), one fold wave + scoped re-review, gates again, push, watch CI, memory note + handoff.
