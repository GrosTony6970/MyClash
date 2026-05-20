# Tournament configuration: wizard at create + Settings page at edit

**Status**: design

**Audience**: organizers configuring tournaments via the web-admin.

---

## Context

Today, tournament creation and editing on web-admin surface only a small fraction of the configuration the backend already persists. The current state:

- **Create page** ([`apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/new/page.tsx`](apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/new/page.tsx)) exposes: `name`, `slug`, `weapon`, `category`. Everything else defaults silently.
- **Edit modal** (inside [`tournaments/page.tsx`](apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/page.tsx)) exposes: `name`, `weapon`, `category`, `status`.
- **Scoring-config sub-page** ([`/tournaments/[tournamentId]/scoring-config`](apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/[tournamentId]/scoring-config/page.tsx)) DOES expose timer, side colors, scoring buttons, afterblow, point cap, locking, and penalty ruleset — but it is not linked from create, not linked from the edit modal, and operators consistently miss it.

Two further blocks of backend-supported configuration have no UI anywhere:

1. **TF_v1 ruleset internals**: `winBonus`, `afterblowWindowMs`, `targetValues.{deepTarget, shallowTarget}`, `forfeitPolicy.{forfeitDrawsCount, forfeitFighterBefore1stMatch, disqualifyAfter}`. All persisted in `tournaments.ruleset_config` JSONB.
2. **Ruleset selection itself**: `rulesetCode` / `rulesetVersion` are hardcoded to `TF_v1` v1 at create. The backend supports other rulesets via the `@myclash/rulesets` package.

This design covers both gaps with one structural change.

---

## Goals

1. Make every backend-supported tournament configuration field reachable from the UI.
2. Make the configuration reachable in a single discoverable path — no more hidden `/scoring-config` URL.
3. Keep quick name/status edits fast (don't force operators through a long form to rename a tournament).
4. Survive mid-creation interruptions: a half-configured tournament should be resumable.

## Non-goals

- Reshape the ruleset model itself or ruleset-runtime services. We're only exposing existing fields.
- Build a wizard for events (only tournaments).
- End-to-end Playwright tests for the wizard. Manual smoke + targeted unit tests cover it.
- Visual regression infrastructure.

---

## Architecture overview

Two UI surfaces, one renamed URL, one new lightweight API endpoint.

**Frontend**

1. **Create wizard** — `/org/[slug]/events/[eventId]/tournaments/new` keeps its URL but becomes a 4-step wizard: Basics → Match Format → Display → Advanced.
2. **Settings page** — `/tournaments/[tournamentId]/scoring-config` is **renamed** to `/tournaments/[tournamentId]/settings`. The old URL returns a permanent redirect to `/settings#match-format`. The page grows a left-rail vertical-tab layout with four sections matching the wizard.
3. **Discoverability** — tournaments list row grows a "Settings" affordance; the quick-edit modal grows a "Open settings →" banner.

**Backend**

1. `UpdateTournamentDto` (and `CreateTournamentDto`) accept nested optional fields: `rulesetConfig`, `lockConfig`, and the full `scoringConfig` shape.
2. PATCH endpoint deep-merges nested config blobs so per-step wizard PATCHes don't wipe earlier-step fields.
3. New `GET /api/v1/rulesets` returns `[{ code, version, label }]` so the Basics step's ruleset picker is data-driven.

**Persistence model**

- Step 1 (Basics) submit → `POST /events/:eventId/tournaments` returning `{ id, status: 'draft' }`. URL replaces to include the new id so refresh resumes.
- Steps 2–4 submit → `PATCH /tournaments/:id` with that step's fields only (deep-merged server-side).
- "Finish" on step 4 → final PATCH. Status stays `draft` unless the user explicitly ticks "Publish on finish" (off by default).
- Draft tournaments appear in the list with a "Resume setup" link.

No DB migrations — every new field lives inside the existing JSONB columns (`ruleset_config`, `scoring_config`, `lock_config`).

---

## Wizard — step by step

Defaults shown in parentheses. Every step has a default so an unedited "Next" is valid.

### Step 1 — Basics

- `name` (required, 2–200 chars)
- `slug` (auto-generated from name, editable, lowercase + hyphens)
- `weapon` (free text, optional)
- `category` (free text, optional)
- `ruleset` — `{code, version}` picker, options from `GET /rulesets`. Default: `TF_v1` v1.
- `penaltyRulesetId` — dropdown from existing penalty rulesets, optional, default null.

On Next: `POST /events/:eventId/tournaments` → returns `{ id, status: 'draft' }`. Subsequent steps PATCH that id.

### Step 2 — Match Format

- `pointCap` (TF_v1: 5)
- `timerMode` (`countdown` | `countup`, default `countdown`)
- `timeLimitsSeconds.pool` / `.bracket` / `.finals` (TF_v1 defaults — read from ruleset)
- `softClockLimitSeconds` (default 60)
- `maxDoubleHits` (default 3, nullable)
- `afterblowMode` (`full` | `deductive`, only shown when ruleset is TF_v1)
- `scoringDirection` (`normal` | `reverse_zero_loses`)

### Step 3 — Display

- `display.sideColors.red` / `.blue` (color enum)
- `buttons.clean[]` (label, value, visible) — repeater
- `buttons.afterblow[]` (label, attackerPts, defenderPts, visible) — repeater, TF_v1 only

Re-uses the entire current scoring-config Display section verbatim.

### Step 4 — Advanced (skippable; "Use defaults and finish" shortcut visible at top)

TF_v1 ruleset internals (only when ruleset is TF_v1):

- `winBonus` (3)
- `afterblowWindowMs` (1000)
- `targetValues.deepTarget` (2) / `.shallowTarget` (1)
- `forfeitPolicy.forfeitDrawsCount` (false)
- `forfeitPolicy.forfeitFighterBefore1stMatch` (false)
- `forfeitPolicy.disqualifyAfter` (2)

Locking (ruleset-agnostic):

- `lockConfig.autoLockEnabled` (false)
- `lockConfig.autoLockDelayMinutes` (30)
- `lockConfig.autoLockCompletedPools` (false)
- `lockConfig.autoLockCompletedBrackets` (false)

On Finish: PATCH tournament with final fields. Status stays `draft` unless the user toggles "Publish on finish" (default off).

### Wizard chrome

- Top: step indicator `1/4 Basics · 2/4 Match format · 3/4 Display · 4/4 Advanced`. Completed steps are clickable for back-navigation.
- Bottom: `Cancel` (exits to tournaments list; draft remains), `Back`, `Next` / `Finish`.

---

## Settings page

URL: `/org/[slug]/events/[eventId]/tournaments/[tournamentId]/settings`. The old `/scoring-config` path returns a permanent redirect to `/settings#match-format`.

### Layout (two-column, full-width)

```
┌────────────────┬──────────────────────────────────────────┐
│  Sidebar       │  Section header + form                   │
│                │                                          │
│  Basics      ▸ │  [active section's fields here]          │
│  Match format  │                                          │
│  Display       │                                          │
│  Advanced      │                                          │
│                │                                          │
│  ── divider ── │                                          │
│  Status: draft │                                          │
│  [Publish]     │                                          │
│  [Archive]     │                                          │
│                │                          [Save changes]  │
└────────────────┴──────────────────────────────────────────┘
```

- Left rail: 4 tabs matching wizard sections + status footer with lifecycle buttons (Publish / Unpublish / Archive). Active tab uses the red-800 accent.
- Right pane: only the active section's form fields. Each section has its own `Save changes` button — a typo in one field doesn't block saving an unrelated section.
- Section anchor in URL: `#basics`, `#match-format`, `#display`, `#advanced`. Deep links and refreshes land on the right tab.

### Field parity with the wizard

Each tab renders the same form components as the wizard step of the same name. The only difference is chrome — wizard has step indicator + Back/Next; Settings has per-section Save.

### Resuming a draft

Tournaments list shows drafts with a `Resume setup` button that deep-links into the **wizard at the user's last-completed step**, computed by `computeWizardStep(tournament)`:

- Step 1 done when `name`, `slug`, `ruleset_code` are set.
- Step 2 done when `scoring_config.pointCap` is set.
- Step 3 done when `scoring_config.buttons` is non-empty.
- Step 4 done when `ruleset_config` (TF_v1) or `lock_config` is non-default.

This is heuristic — operators can always click step indicators to jump back. Used only to decide where the `Resume setup` button lands by default. After the first completion, `Resume setup` disappears and only `Settings` remains.

---

## Backend changes

### 1. DTO extensions ([`apps/api/src/modules/events/dto/tournaments.dto.ts`](apps/api/src/modules/events/dto/tournaments.dto.ts) or current location)

Both `CreateTournamentDto` and `UpdateTournamentDto` accept these nested optional fields (validated with class-validator + nested DTOs):

- `rulesetCode?`, `rulesetVersion?`, `penaltyRulesetId?` — top-level columns.
- `rulesetConfig?: { winBonus?, afterblowWindowMs?, targetValues?: { deepTarget?, shallowTarget? }, forfeitPolicy?: { forfeitDrawsCount?, forfeitFighterBefore1stMatch?, disqualifyAfter? } }` — TF_v1 internals.
- `lockConfig?: { autoLockEnabled?, autoLockDelayMinutes?, autoLockCompletedPools?, autoLockCompletedBrackets? }`.
- `scoringConfig?: { afterblowMode?, buttons?: {...}, display?: { sideColors?: {...} }, ...existing fields }` — formalized DTO matching what the scoring-config page already PATCHes.

Numeric ranges enforced: `afterblowWindowMs >= 0`, `disqualifyAfter >= 1`, `autoLockDelayMinutes >= 0`, etc.

### 2. Deep-merge on PATCH

When PATCHing nested config blobs, the tournaments service **deep-merges** the incoming partial onto the stored value so per-step wizard PATCHes don't wipe earlier-step fields. Documented in the service.

Example: PATCH `{ rulesetConfig: { winBonus: 5 } }` on a tournament whose stored `rulesetConfig` is `{ winBonus: 3, targetValues: { deepTarget: 2 } }` results in `{ winBonus: 5, targetValues: { deepTarget: 2 } }`. `targetValues` survives.

### 3. Ruleset switch behavior

When a PATCH sets `rulesetCode` to a different value than the stored one, the service:

- Clears the existing `rulesetConfig` (TF_v1 internals on a Generic_PointsCap tournament would be stale).
- Fills in default `rulesetConfig` for the new ruleset (from the `@myclash/rulesets` package).

### 4. `GET /api/v1/rulesets` (new endpoint)

- Returns `[{ code: 'TF_v1', version: '1', label: 'TF v1 (afterblow + targets)' }, …]`.
- Source of truth: iterates over the `@myclash/rulesets` package's exports.
- Public-readable — no auth gate. It's catalog data.
- Lives in a new tiny `RulesetsController` (own module if it grows, otherwise alongside events).

### What's NOT changing

- No new HTTP endpoints beyond `GET /rulesets`. PATCH/POST stay where they are.
- No DB migrations — all new fields live inside existing JSONB columns.
- No changes to scoring-runtime services (TF_v1 service, etc.) — they already cope with nulls and apply defaults at read time.

---

## Discoverability wiring

**Tournaments list row** ([`tournaments/page.tsx`](apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/page.tsx))

- Current row actions: Edit (modal) · Publish/Unpublish · Archive · Delete.
- Adds **Settings** (gear icon) → opens `/tournaments/[id]/settings#basics`.
- Drafts (status === 'draft' AND any wizard step incomplete) get a **Resume setup** primary button that deep-links into the wizard at the right step.
- Per-row footer chip on drafts: `Draft — step 2 of 4`.

**Quick-edit modal** (existing on the list page)

- Trimmed to name + status. Banner at bottom:
  > _Looking for timer, fighter colors, scoring buttons, or advanced rules? **Open settings** →_
- Link opens the Settings page in the same tab.

**Sidebar nav**

- No new entry. Settings is per-tournament, accessible from the list rows.

**Legacy URL redirect**

- `/scoring-config` returns 301/308 to `/settings#match-format`. Existing bookmarks survive.

**i18n**

- New keys under `organizer.tournaments.wizard.*` and `organizer.tournaments.settings.*` (EN + FR). Reuses existing keys for shared labels.

---

## Testing strategy

### Backend vitest

Extend [`apps/api/src/modules/events/tournament-config.test.ts`](apps/api/src/modules/events/tournament-config.test.ts):

- `UpdateTournamentDto` accepts the new nested fields and rejects out-of-range numbers (`afterblowWindowMs` negative, `disqualifyAfter < 1`, `autoLockDelayMinutes < 0`).
- Deep-merge: PATCH with `{ rulesetConfig: { winBonus: 5 } }` on a tournament whose stored `rulesetConfig` is `{ winBonus: 3, targetValues: { deepTarget: 2 } }` produces `{ winBonus: 5, targetValues: { deepTarget: 2 } }`.
- Ruleset switch: PATCH `rulesetCode: 'Generic_PointsCap'` clears TF_v1-only fields from `rulesetConfig` and fills Generic defaults.

New tiny test file for the rulesets endpoint:

- `GET /api/v1/rulesets` returns at least one entry; each entry has `{ code, version, label }`.
- Public-readable (no auth assertion).

### Frontend vitest (web-admin already has vitest)

- Unit test on `computeWizardStep(tournament)` — given tournament rows in various states, returns the right step number (1–4). This is the only non-trivial frontend logic worth a unit test.
- No render tests for the wizard itself — it's mostly form glue.

### Manual smoke

1. **Create flow**: 4-step wizard. After step 1 the draft persists; refresh mid-wizard resumes correctly. Draft visible in list; `Resume setup` jumps to the right step.
2. **Edit flow**: open Settings from a list row. All four sections show the tournament's current values. Per-section save updates only that section; an invalid input in one section doesn't block saving another.
3. **Ruleset switch**: change ruleset in Basics → downstream steps adapt (TF_v1 fields hide when switching to Generic_PointsCap). Stored `rulesetConfig` is cleared and re-defaulted on the switch.
4. **Legacy URL redirect**: visiting `/scoring-config` 301s to `/settings#match-format`.
5. **Quick-edit modal**: still works for rename + status, banner links to Settings.

### What we're NOT testing

- Visual regression of wizard chrome.
- End-to-end Playwright on the wizard — manual smoke is enough.
- Ruleset-runtime correctness (already covered by existing TF_v1 service tests).

---

## Open items for the implementation plan

- Confirm which rulesets the `@myclash/rulesets` package actually exports today. If only `TF_v1` is production-ready, the picker still ships but the dropdown has one option for v1 — fine.
- Find or pick a shared deep-merge utility for the service-side merge. If none exists, a small `deepMergeJsonb()` helper lives next to the tournaments service.
- Confirm route-level redirect mechanism in Next.js app router for the `/scoring-config` → `/settings` rename (either `redirects()` in `next.config.ts` or a Next.js route file).
