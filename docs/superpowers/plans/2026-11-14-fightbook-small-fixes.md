# FightBook small fixes (slice 6 leftovers + the scan's Event sentence) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four small fixes the operator picked on 2026-11-14: a route-level proof that a refused
daily-limit save writes nothing; the two spar reminders set independently; keyboard focus back on
the daily-limit menu after a save; the QR scan's Event refusal names both fighters.

**Architecture:** No migration, no new route, no new table. Task 1 is a test. Task 2 is
`spar-reminder.ts`. Task 3 is `FightBookSettingsPanel.tsx`. Task 4 is the scan's web sentence
(`use-qr-scan.ts`, i18n EN + FR) and the API's database sentence for `bad_event`.

**Tech Stack:** NestJS + Fastify (`configureHttpApp`, `ZodOrClassValidationPipe`), Next 16 /
React 19, `@myclash/i18n`, Vitest.

**Spec / rulings** (2026-11-14, `C:\Users\Tony\.claude\plans\fightbook-handoff.md`):

- **758** Bundle: slice 6's deferred minors T2 (no route-level "refused, nothing written" test),
  T3 (the two reminders set in sequence), T4 (a disabled select drops keyboard focus), and the
  scan's `bad_event` sentence that names the wrong person. Not slice 6's other T2 (the save order).
- **759** The daily-limit menu keeps its grey-out (`disabled`) during a save (slice 6 Ruling F
  stands); when the save ends, focus returns to the menu if it was there.
- **760** A refused scan's `bad_event` reads, on the scan only: EN "This code works only at a
  public Event you are both at, on a day it runs." FR "Ce code ne fonctionne que pendant un
  événement public auquel vous participez tous les deux, un jour où il a lieu." Asks, free-now and
  open calls keep today's `bad_event` sentence.

## In plain words

1. A test sends the real route a daily limit of 25 (the most is 20) and proves the server refuses it
   and saves nothing.
2. When a spar with a time is agreed, each fighter's 10-minute reminder is set on its own. If one
   fails, the other is still set, and the failure is logged.
3. Léa picks a limit with the keyboard. The menu greys out while it saves, then her focus is back on
   it, not at the top of the page.
4. Sam scans Léa's code; one of them is not on the Event's roster. Sam now reads that the code works
   only at an Event they are BOTH at. The scanner still cannot tell which of the two failed
   (Decision 14: same code `bad_event`, same status 400, same sentence either way).

## Global Constraints

- One task = one commit, Conventional Commits, subject lowercase after the scope.
- Every user-facing string in BOTH `packages/i18n/src/messages/en/publicApp.ts` and `.../fr/...`,
  whole literal keys; then `pnpm --filter @myclash/i18n build` and `pnpm --filter @myclash/i18n
test` run directly (turbo caches it).
- No status, code or timing changes anywhere (ruling 672: a face only a block can produce is a
  leak). Task 4 changes words only.
- Complexity: `pnpm quality:complexity` after prettier, before every commit (files ≤ 400 lines,
  functions ≤ 50; tests count).
- After every subagent: `git status --short` and `git stash list`. Another session commits here:
  `git fetch`, `git log --oneline -1`, `git status --short` before staging; explicit paths;
  `git diff --cached --stat`.

## Decisions taken in this plan

- **D1 (Task 1) What "route-level" means.** The request goes through the app's real HTTP pipeline:
  a Nest Fastify app built with `configureHttpApp` (`apps/api/src/common/http-bootstrap.ts:39`
  registers `ZodOrClassValidationPipe` globally) around the REAL `FightBookController`, its services
  stubbed. `PATCH /api/v1/me/fightbook/settings` (the global prefix, `global-prefix.ts:15`) with
  `{ dailyLimit: 25 }`, `{ dailyLimit: 0 }`, `{ dailyLimit: 2.5 }` and `{}` answers 400, and the
  stubbed `FightBookSettingsService.set` (the only writer) was NEVER called; a valid
  `{ dailyLimit: 3 }` reaches `set` once, its SECOND argument `{ dailyLimit: 3 }` (the call is
  `set(caller, dto)`, `fightbook.controller.ts:162`), so the test can fail: the stub is reachable.
  The shared edge harness cannot host it (fixed controller list, `http-edge-app.ts:228-248`): build
  the app in the test file — create it, `configureHttpApp(app, { reportException: () => undefined
})` (as `http-edge-app.ts:331`), THEN `app.init()`. The caller: a
  test `APP_GUARD` (`useValue`) that sets `req.identity` to a claimed identity (guards run before
  pipes), and `SupabaseService` stubbed as `{ service: mockSupabase({ global_persons: { rows }
}).service }` with the caller's live profile, as `fightbook.controller.test.ts:23-35` does
  (`fightBookCaller` reads `req.identity`, `identity.ts:44`, then the profile, `fightbook-caller.ts:34-38`).
- **D2 (Task 2) Independent reminders.** `ring` (`spar-reminder.ts`) starts every
  `scheduleReminder` call before awaiting any (`Promise.allSettled`), and logs each rejected one
  with the request id and the reason — no user id, no name (the same line shape as today's
  `d.logger.error`). The outer `catch` stays for the reads. Race named: the two calls overlap on
  purpose; they write two different jobs (the scheduler's job id holds kind + entity + user), so
  neither can overwrite the other.
- **D3 (Task 3) Focus return.** At the pick, the hook notes whether the menu holds focus
  (`document.activeElement === ref`). When `saving` turns false and the menu is enabled again, it
  focuses the menu ONLY if it held focus at the pick AND focus now sits nowhere (`document.activeElement`
  is `document.body` or null) — a fighter who clicked or tabbed elsewhere during the save keeps
  their place. Done in an effect after the re-render (a disabled element cannot take focus). Some
  browsers leave `document.activeElement` on a control after it is disabled: "still on the menu"
  also counts as "nowhere else" (a second `focus()` is harmless).
- **D4 (Task 4) Where the scan sentence lives.** A new key `publicApp.fightBook.qr.badEvent` (EN +
  FR, ruling 760). `use-qr-scan.ts` uses it when `res.code === 'bad_event'`; every other code keeps
  `sparRefusalKey`. The API's database sentence for `bad_event` (`spar-refusal-sentences.ts`) is
  raised ONLY by the scan (`0270_fightbook_floor.sql:343` is the one `raise … 'bad_event'` in the
  migrations), so it becomes the EN sentence without its period. The API's own scan check
  (`offTheFloor()`, `floor-event.ts:17`) is shared with free-now and open calls: unchanged for them.
- **D5 (Task 4) Decision 14 in the raw answer too.** The scan's own Event check (`atEvent`,
  `spar-qr.service.ts:135-138`) answers the SAME `message` as the database's refusal, so not even
  the raw answer tells which fighter is off the roster: `floorEvent` (`floor-event.ts:26-34`, the one
  owner of the floor gate) takes an optional refusal (`refuse = offTheFloor`), and `atEvent` passes
  one that answers `badRequest('bad_event', SPAR_REFUSAL_SENTENCES.bad_event)` — for its own
  `!today` refusal too. Free-now and open calls pass nothing and answer as today.

## Review Focus

- Task 1: would the test stay green if the schema's `.max(20)` were deleted, or if the pipe were
  not global? It must not.
- Task 2: the two calls really overlap (a test holds the first promise and sees the second called).
- Task 3: the two focus cases (focus back; focus left where the fighter put it).
- Task 4: the scan shows the new sentence for BOTH sides' refusals (the API's check and the
  database's), and no other surface changes.

## File map

| File                                                                                          | Task | Change                         |
| --------------------------------------------------------------------------------------------- | ---- | ------------------------------ |
| `apps/api/src/modules/fightbook/fightbook-settings.route.test.ts` (new)                       | 1    | the route test                 |
| `apps/api/src/modules/fightbook/spar-reminder.ts`                                             | 2    | `ring` sets both at once       |
| `apps/api/src/modules/fightbook/spar-reminder.test.ts`                                        | 2    | overlap + one-fails tests      |
| `apps/web-public/app/me/fightbook/FightBookSettingsPanel.tsx`                                 | 3    | focus return                   |
| `apps/web-public/app/me/fightbook/FightBookDailyLimit.test.tsx`                               | 3    | the two focus cases            |
| `packages/i18n/src/messages/{en,fr}/publicApp.ts`                                             | 4    | `fightBook.qr.badEvent`        |
| `apps/web-public/app/me/fightbook/use-qr-scan.ts`                                             | 4    | scan uses the key              |
| `apps/web-public/app/me/fightbook/QrScan.test.tsx`                                            | 4    | `bad_event` row → new sentence |
| `apps/api/src/modules/fightbook/spar-refusal-sentences.ts` + `spar-refusal.test.ts`           | 4    | the DB sentence                |
| `apps/api/src/modules/fightbook/floor-event.ts`, `spar-qr.service.ts`, `spar-qr.scan.test.ts` | 4    | D5                             |
| `docs/ARCHITECTURE.md` §11septies                                                             | 2, 4 | one sentence each              |

### Task 1: A refused daily-limit save writes nothing (route-level)

- [ ] Write `fightbook-settings.route.test.ts` per D1: the four refused bodies answer 400 and `set`
      is never called; the valid body reaches `set` once with the parsed value.
- [ ] Prove it can fail: temporarily delete `.max(20)` from `settingsSchema`
      (`fightbook.controller.ts:62`) and see the `25` case go red; restore byte-identical; record both
      runs in the report.
- [ ] `pnpm --filter @myclash/api exec vitest run src/modules/fightbook/fightbook-settings.route.test.ts`,
      typecheck, lint, prettier, complexity. Commit
      `test(fightbook): a refused daily-limit save writes nothing, through the real route`.

### Task 2: Each fighter's reminder is set on its own

- [ ] Tests first (red on today's code): (a) the first `scheduleReminder` held unresolved → the
      second has been called too (overlap); (b) the first rejects → the second is still called and
      resolves, and exactly one PER-REMINDER error line (its own text, distinct from the outer catch's
      "was not set" line, which must NOT appear) names the request id; (c) both reject → two
      per-reminder lines. The happy path is already pinned (`spar-reminder.test.ts:74-97`): it stays
      green unchanged (a guard, not a red test).
- [ ] Implement D2.
- [ ] ARCHITECTURE §11septies.10 (the reminder paragraph): one sentence — each fighter's reminder is
      set on its own; a failure is logged and does not stop the other.
- [ ] `pnpm --filter @myclash/api exec vitest run src/modules/fightbook/spar-reminder`, typecheck,
      lint, prettier, complexity. Commit
      `fix(fightbook): each fighter's spar reminder is set on its own`.

### Task 3: Focus comes back to the daily-limit menu after a save

- [ ] Tests first in `FightBookDailyLimit.test.tsx`. jsdom never moves focus off a disabled
      element, and `select.blur()` on a disabled select does NOTHING (jsdom 30 `focusing.js:46-50,194`).
      So the test does what the browser does another way: while the save is held, focus a throwaway
      `<button>` appended to the body, then remove it — jsdom sends focus to `document.body`
      (`Node-impl.js:510-514`) — and ASSERT `document.activeElement === document.body` before
      answering the save (proof the loss really happened). (a) focus the menu, pick 3, lose focus as
      above during the held save, answer the save → `document.activeElement` is the menu;
      (b) same, but focus another button during the save → after the answer, focus stays on that button;
      (c) a FAILED save also returns focus (the menu shows the old value again). Record (a) and (c) red
      before the change; (b) may be green today — say so.
- [ ] Implement D3. Keep `disabled={saving}`.
- [ ] `pnpm --filter @myclash/web-public exec vitest run app/me/fightbook/FightBookDailyLimit`,
      typecheck, lint, prettier, complexity. Commit
      `fix(fightbook): keyboard focus comes back to the daily limit after a save`.

### Task 4: The scan's Event refusal names both fighters

- [ ] i18n: `publicApp.fightBook.qr.badEvent` in EN and FR with ruling 760's exact text; build and
      test i18n.
- [ ] `use-qr-scan.ts`: `bad_event` → the new key (D4). `QrScan.test.tsx:235` (the `bad_event` row)
      expects the new sentence.
- [ ] API: `spar-refusal-sentences.ts` `bad_event` → `'This code works only at a public Event you
are both at, on a day it runs'`; update its row in `spar-refusal.test.ts`. D5: `floorEvent`'s
      optional refusal; `atEvent` passes the scan's. In `spar-qr.scan.test.ts` (~:102-125, which covers
      the API's own check) assert that the scanner off the roster, the Event not public, the day not
      running AND the database's refusal (`P0001 bad_event`) all answer 400 `bad_event` with the SAME
      message; and in the free-now / open-call tests that their refusal message is unchanged.
- [ ] Prove no other surface changed: grep the web tests for the old sentence `'A spar can only
name a public Event you are at'` — every hit outside the scan stays green unchanged.
- [ ] ARCHITECTURE §11septies (the "Refusal words and status codes" paragraph): one sentence — the
      scan shows its own `bad_event` sentence naming both fighters (ruling 760), and the scan's own
      Event check answers the same raw message as the database's refusal (Decision 14, D5).
- [ ] Web + API tests for the touched files, both typechecks, lints, prettier, complexity. Commit
      `fix(fightbook): a refused QR scan says the Event must be one you are both at`.

### Task 5: Falsify, gates, review, push

- [ ] Code falsifier (cases added to a copy of `falsify-nf-head.mjs`): G1 `.max(20)` → `.max(30)`
      → Task 1 red; G2 the settings handler calls `set` before validation can refuse (not possible by
      edit — skip; G1 covers it); G3 `ring` back to a sequential `for … await` → Task 2 (a) red;
      G4 a rejected reminder rethrown → (b) red; G5 the focus effect removed → Task 3 (a) red; G6 the
      "focus sits nowhere" check removed → (b) red; G7 the scan's `bad_event` branch removed → Task 4
      red; G8 the DB sentence back to the old text → `spar-refusal.test.ts` red; G9 `atEvent` passes no
      refusal (back to `offTheFloor`) → the scan's same-message test red; G10 `floorEvent` ignores its
      `refuse` argument → red.
- [ ] The 32 gates (`gates.sh`), local gitleaks, cold whole-slice review
      (`code-architecture-reviewer`, Opus), one fold wave + scoped re-review, gates again, push, watch
      CI, memory note + handoff.
