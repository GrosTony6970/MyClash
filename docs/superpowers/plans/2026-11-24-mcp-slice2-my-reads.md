# MCP slice 2 — "my" read tools: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person's Claude can read what that person sees in MyClash about themselves — their
Events, schedule, fights, stats, workshops — and an Event's public results, through new MCP tools.

**Architecture:** Each tool is one file in `apps/api/src/modules/mcp/tools/` that calls an existing
service with ids taken from the door's caller (never a token), applies the same read gate the app's
route applies, and maps the answer to names/slugs/times/scores — no raw ids. Events and Tournaments
are named by slug.

**Tech Stack:** NestJS 11 / Fastify, `@modelcontextprotocol/sdk` 1.32.2 (`McpServer.registerTool`
or the API Task 3 used), zod, vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-mcp-server-design.md` (slice 2; calls B, F).

**Branch:** `feat/mcp-server` (worktree `.claude/worktrees/mcp-server`, PR #110; operator: same branch).

## Global Constraints

- The caller is `McpCaller { userId, email, clientId }` (`modules/mcp/mcp-door.guard.ts`). A tool
  NEVER calls `getAuthUser`, `ParticipantIdentityService`, `AuthService`, `PersonEmailChangeService`
  or `StaffService` (they re-read the login; connector tokens are refused there). The reader is
  `{ userId: caller.userId, staff: null }`.
- No raw ids in any tool output: no UUID-shaped string at any depth (`/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i`).
  Handles are slugs (`eventSlug`, `tournamentSlug`). Every tool test asserts this through one shared
  helper.
- Data minimisation: never pass a service row through. No `email`, `date_of_birth`, `phone`,
  `claimed_by_user_id`, penalty/protest internals beyond what the person's own `/me` pages show.
- Same visibility as the app: an Event the caller cannot read is answered exactly like an unknown
  one (`No Event "<slug>" that you can see.`), never a different message.
- Tool names `snake_case`; descriptions English and machine-facing (call F); a refusal is an MCP tool
  error result (`isError: true`, one plain sentence), never a thrown 500.
- Limits: list tools cap at 50 rows (`limit` arg, default 20, 1–50); the cap is in the description.

## Review Focus

1. **A hidden or draft Event by slug** — answered as unknown (Task 1 test `refuses an Event the caller cannot read as unknown`).
2. **A person with no roster row at that Event** — `my_schedule` says so plainly, not an empty
   success that reads as "nothing today" (Task 2 test `says when you are not on this Event's roster`).
3. **A hidden profile's owner** — must still see their own fights and stats, as on `/me` (Task 3
   test `the owner of a hidden profile still sees their own fights`).
4. **A UUID leaking through a nested field** (bracket slots, registrations) — the shared helper on
   every tool test.
5. **A Tournament not yet published** — `tournament_standings` answers like an unknown Tournament
   (Task 4 test `refuses an unpublished Tournament as unknown`).

## Calls made (operator may overrule)

- **FightBook spars stay out of slice 2.** FightBook is social (blocks, safety flags, other people's
  names in spar records); sending it to an AI is a separate decision. Slice 2 covers bouts and stats.
- **`event_schedule` is filtered** to one Tournament or one day (both optional) and capped like the
  other lists, so one call cannot dump a whole Event.

---

### Task 1: Tool plumbing, `my_events`, `my_upcoming`

**Files:**

- Create: `apps/api/src/modules/mcp/tools/readable-event.ts` (+ test), `apps/api/src/modules/mcp/tools/no-raw-ids.test-helper.ts`, `apps/api/src/modules/mcp/tools/my-events.ts` (+ test), `apps/api/src/modules/mcp/tools/my-upcoming.ts` (+ test)
- Modify: `apps/api/src/modules/mcp/mcp-server.ts` (register), `mcp.module.ts` (imports), `mcp.http.test.ts` (tools/list now lists every tool, sorted)

**Interfaces:**

- Produces: `readableEventBySlug(slug: string, caller: McpCaller, deps: { supabase; orgs }): Promise<CompetitionEvent | null>` — `resolveEventId` (`common/event-ref.ts:37`) then `readableEvent` (`common/auth/competition-visibility.ts:171`); null for unknown OR hidden (catch the 404). `toolRefusal(text: string): CallToolResult`; `expectNoRawIds(value: unknown): void` (test helper, the Global Constraints regex). `McpToolDeps` grows by the services each task adds.
- `my_events()` → `MeEventsService.listMyEvents(reader)` mapped to `{ events: { name, slug, startDate, endDate, status, kind, roles: string[], tournaments: { name, slug, weapon, registered, poolName }[], refereeOf: { tournamentName, poolName, role, liceName }[], teaching: { workshopName, start, end, location, cancelled }[] }[] }`.
- `my_upcoming({ limit })` → `MeEventsService.getUpcoming(reader, limit)` mapped to names/slugs/times (drop `eventId`, `matchId`).

- [ ] **Step 1: Failing tests** — `readable-event.test.ts`: unknown slug → null; hidden Event (readableEvent throws NotFound) → null; readable → the Event. `my-events.test.ts` / `my-upcoming.test.ts` (service doubles carrying UUIDs everywhere): mapped shape as above; `expectNoRawIds(result)`; `listMyEvents` called with `{ userId, staff: null }`; `limit` clamped 1–50, default 20. `mcp.http.test.ts`: tools/list = `['my_events','my_upcoming','whoami']` (extend as later tasks add).
- [ ] **Step 2: Run** `pnpm --filter @myclash/api exec vitest run src/modules/mcp` → FAIL.
- [ ] **Step 3: Implement** the four files; register both tools; add `OrganizationsModule` import if `orgs` is not reachable.
- [ ] **Step 4: Run** → PASS; red-proof: let one mapper pass `event.id` through → `expectNoRawIds` fails; `git restore`.
- [ ] **Step 5: Commit** `feat(mcp): my events and what is next, by name`.

### Task 2: `my_schedule`

**Files:** Create `apps/api/src/modules/mcp/tools/my-schedule.ts` (+ test); modify `mcp-server.ts`, `mcp.module.ts` (`PersonsModule` exports `PublicScheduleService`).

**Interfaces:**

- Consumes: Task 1 `readableEventBySlug`, `toolRefusal`, `expectNoRawIds`.
- `my_schedule({ event: string })`: `readableEventBySlug` → null → refusal; claimed person = `persons` where `event_id = event.id and claimed_by_user_id = caller.userId` (`.maybeSingle()`; a read error → refusal "Could not read your schedule. Try again."); none → refusal `You are not on the roster of <Event name>.`; else `PublicScheduleService.getSchedule(event.id, personId, personId)` mapped to `{ event: { name, slug }, fights: { tournamentName, tournamentSlug, roundCode, opponentName, liceName, start, status, score }[], refereeing: { tournamentName, poolName, role, liceName, start, end }[], workshops: { name, start, end, location, cancelled }[] }`.

- [ ] **Step 1: Failing tests** — `says when you are not on this Event's roster`; `refuses an Event the caller cannot read as unknown`; the mapped shape from a `PersonSchedule` double full of UUIDs + `expectNoRawIds`; `getSchedule` called with `(eventId, personId, personId)` (own view); the persons query asserts the select string and both `.eq` filters (repo rule: mocks ignore projections).
- [ ] **Step 2–4:** run → FAIL; implement; run → PASS; red-proof the roster refusal.
- [ ] **Step 5: Commit** `feat(mcp): my schedule at an Event`.

### Task 3: `my_stats`, `my_fight_history`, `my_workshops`

**Files:** Create `tools/my-stats.ts`, `tools/my-fight-history.ts`, `tools/my-workshops.ts` (+ tests); modify `mcp-server.ts`, `mcp.module.ts` (`FightersModule`).

**Interfaces:**

- `my_stats()` → `FightersService.getMyDashboard(userId)` → `{ career: <the summary numbers the /me dashboard shows: bouts, wins, losses, draws, per-weapon>, refereeing: <getMyRefereeStats summary> }`; no profile fields at all. No claimed profile (404 from getMyProfile) → refusal `You have no fighter profile yet.`
- `my_fight_history({ limit, offset })` → the OWNER's path the app's `/me` fights view uses. Read the web-public `/me/fighter` page to find which API route it calls for the owner and use that route's service method; `listMatchesPaginated` hides a hidden profile even from its owner (`fighters.service.ts:947`), so it is acceptable ONLY if the app's owner view uses it too. Map to `{ total, fights: { eventName, eventSlug, tournamentName, tournamentSlug, date, opponentName, result, score }[] }`.
- `my_workshops()` → `getInstructorWorkshops(userId)` + `getMyWorkshopHistory(userId)` → `{ teaching: [...], attended: [...] }` by name/time/location; same visibility as `/me` (these methods drop test Events only — keep that, it is what the app shows).

- [ ] **Step 1: Failing tests** — each mapped shape + `expectNoRawIds`; `my_stats` output has no `email`/`date_of_birth`/`phone` key at any depth; `the owner of a hidden profile still sees their own fights` (double: profile hidden, owner path returns bouts → listed); limit/offset clamped.
- [ ] **Step 2–4:** run → FAIL; implement; PASS; red-proof the profile-field exclusion.
- [ ] **Step 5: Commit** `feat(mcp): my fights, my numbers, my workshops`.

### Task 4: `event_info`, `tournament_standings`, `event_schedule`

**Files:** Create `tools/event-info.ts`, `tools/tournament-standings.ts`, `tools/event-schedule.ts` (+ tests); modify `mcp-server.ts`, `mcp.module.ts`, `apps/api/src/modules/schedule/schedule.module.ts` (export `ScheduleGridService`).

**Interfaces:**

- `event_info({ event })` → `readableEventBySlug` + `EventsService.listTournaments(event.id, reader)` → `{ name, slug, startDate, endDate, status, venue?, tournaments: { name, slug, weapon, status }[] }`.
- `tournament_standings({ event, tournament })` → `EventsService.getPublicTournamentStandings(eventSlug, tournamentSlug, reader)` (gated inside) mapped to `{ pools: { name, rows: { rank, name, club, wins, ... }[] }[], bracket: { round, fights: { red, blue, winner, score }[] }[] }`; a NotFound → refusal `No Tournament "<slug>" at <Event name> that you can see.`
- `event_schedule({ event, tournament?, day?, limit })` → `ScheduleGridService.listEventSchedule(event.id, reader)` (gated inside), filtered by tournament slug and/or day (Event time zone), sorted by start, capped → `{ fights: { start, liceName, tournamentName, roundCode, red, blue, status }[] }`.

- [ ] **Step 1: Failing tests** — `refuses an unpublished Tournament as unknown`; each shape + `expectNoRawIds`; the schedule filters and cap; day filter uses the Event's time zone (a 23:30Z bout on a UTC+1 Event belongs to the next day).
- [ ] **Step 2–4:** FAIL; implement; PASS; red-proof the day filter.
- [ ] **Step 5: Commit** `feat(mcp): an Event's public results and schedule`.

### Task 5: Docs and the connector e2e

**Files:** `docs/ARCHITECTURE.md` §28 (the tool list, the no-raw-ids rule, the FightBook call), `tests/e2e/48-mcp-connector.spec.ts` (tools/list now the full sorted list; one call of `my_events` returns a list), `tests/e2e/README.md`.

- [ ] **Step 1:** update the e2e expectations; typecheck + `--list`.
- [ ] **Step 2:** docs; `pnpm quality:docs-drift`, `pnpm format:check`.
- [ ] **Step 3: Commit** `docs(mcp): slice 2's tools`.

## After the tasks (controller)

Whole-branch review of slice 2; full `myclash-gates` chain; closing commit deletes this plan; push
to PR #110.
