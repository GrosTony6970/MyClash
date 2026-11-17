# Protest counter Implementation Plan

> **Status (2026-11-17):** Shipped in `0d4853345`, `408f86004`, `7f7a05255`, `e76e0ca80`, `bd9502771` and `a2375ad69` (migration 0276), with the folds `50fce24ed` and `7d5c8faa1` — the protest entry, the pad button, the limit, the TV chip and the statistics. The unchecked `- [ ]` boxes are an artefact of how the plan was written. Do not execute this plan.

**Goal:** The scorekeeper counts each fighter's protests on the scoring pad; the count has a per-Tournament limit that offers a penalty, shows on the TV, sits in the Match history, and feeds the fighter, referee and Event statistics.

**Architecture:** A protest is its own kind of entry: a new table `match_protests` beside `exchanges` and `match_penalties`, its own API module, its own outbox kind `'protest'` on the pad. It shares the pad's sequence counter but never reaches the score recompute, the card ladder or any card count. The limit lives in the Tournament's scoring config (`display.protests`) and is read live; the server decides nothing from it.

**Tech Stack:** Postgres migration (PG17, RLS), NestJS + Zod DTOs (`apps/api`), Dexie outbox (`apps/web-staff`), React 19 shared components (`packages/ui`), Next 16 admin and public apps, `@myclash/i18n`.

**Spec:** `docs/superpowers/specs/2026-11-16-protest-counter-design.md`. Read it first; this plan does not repeat its behaviour section.

## Rulings and calls since the spec

These were settled during the recon of 2026-11-17 and override the spec where they differ.

- **The pad learns "frozen"** (operator, 2026-11-17). The Match summary gains `eventOver`; the protest button goes off when the Event is over, as well as when the Match is locked.
- **The Event statistics protest column goes to everyone who already reads that page** (operator, 2026-11-17): org roles scorekeeper and above. Never the public.
- **Builder's call: a protest on a bout not started is refused**, by the pad (button off) and by the server (`assertBoutTakes` without `directCard`, which refuses `scheduled`).
- **Builder's call: two reset paths, not one.** `MatchesService.resetMatch` (`matches.service.ts:1035-1082`) voids hits and cards as `revert-match.ts` does; both void protests.
- **Builder's call: six commits, not five.** History moves to its own task (Task 2) because the timeline builder change reaches every reader at once.
- **Builder's call: the referee's protest count is per Match, inside `history[]`**, the only private part of `RefereeStats` (`referee-stats.ts:211-255`). No top-level field: the slug route is public.
- **Builder's call: a queued protest stores its fighter's corner in `cardedColor`.** The field's doc comment is widened to "the corner of the fighter this entry names". No new field.
- **Protest buttons on the break screens** (operator, 2026-11-17). The round-break screen (`RoundBreakDialog`, `MatchPauseDialogs.tsx:224-227`, cannot be closed) and the end-of-Match result screen (`MatchResultOverlay.tsx:294`, covers the pad) each carry one protest button per fighter. Without them the ruling "live between rounds and after the end" cannot be reached.
- **The penalty offered is named by its `ref_number` as text.** `penalty_ruleset_entries.ref_number` is TEXT since `0071_penalty_ref_alphanumeric.sql:30-31`, and the API sends it as a string. `offerPenaltyRef: string | null`, compared with `String(e.ref_number)`. (The quick-picks compare a number and are reported to the operator as a separate bug; not touched here.)
- **Builder's calls on the review's open questions:** the two write doors join the archived-lock list, as the card doors do (protests follow the card rule, spec call 4); a changed limit reaches the TV when the bout next changes or the channel falls back to polling (`useLiveMatch.ts:95-97`), accepted; the public list returns `select('*')` as the card list does, because anon already reads those columns through the read rule.

## Global Constraints

- Hard rule 1: no protest ever calls `recomputeMatchScore`, `assertCorrectionLands`, or joins `start-count.ts:62` `nothingOnTheSheet`.
- Hard rule 3: the offline E2E suite passes; a protest tapped offline is in the outbox before any network call.
- Hard rule 4: `match_protests` has RLS enabled, a read rule, no web write.
- Hard rule 6: every string in `en` and `fr`. Words: EN "Protest / Protests", FR "Réclamation / Réclamations".
- Migration number `0276` unless another session lands one first: `ls packages/db/migrations | tail -1` right before creating it.
- Never add `default:` to a switch over `OutboxKind` or `UnifiedEvent['kind']` (memory: `reference_shared_union_widening`).
- Rebuild `packages/types`, `packages/ui`, `packages/rules`, `packages/i18n` dist before any consumer typecheck.
- UI through tokens (`feedback_tokenized_ui`). The card chips' `// raw-color-exempt` does not extend to the protest chip. `TVScoreboard.tsx` is whole-file exempt from the palette lint, so its chip is checked by review.
- Every test over a PostgREST read asserts its `.select()` string (`reference_select_string_must_be_asserted`).
- Every task that adds a read a browser story makes also answers it in each stub the story uses (`tests/a11y/*-stub.ts`): an unknown GET is a 404 in the pad stubs (`pad-clock-stub.ts:245`) and `{}` in the catch-all (`tests/a11y/helpers.ts:54`), and either breaks CI's `e2e` job (`ci.yml:536`). Run the whole `pnpm test:e2e` after Tasks 2, 3 and 4.
- The complexity baseline is line-keyed (`docs/code-quality-complexity-baseline.json`); re-point it per edited file through `myclash-gates` in every task that touches a baselined function.
- One commit per task, Conventional Commits, explicit `git add` paths, `git log --oneline -1` before staging, `git fetch` before pushing. Gate chain through the `myclash-gates` skill before each push.

## Review Focus

1. **A protest row printed as `#null`.** `UnifiedEvent.number` becomes `number | null`; a template literal compiles with `null`. Owned by Task 2 (render test of `MatchTimeline`, unit test of `exchangeOptionLabel`, `undone-line`).
2. **A Tournament saved before this feature** (no `display.protests`) must read as "no limit" on the pad, the TV and the settings page. Owned by Task 4 (`protestRulesOf({})`, normaliser, `displayForm`).
3. **A protest tapped while a card of the same bout is held** in the inbox waits behind it (per-bout order, `press-send.ts:164-178`), still counts on the chip, and drains once the card is resolved. Owned by Task 3.
4. **Undo when the newest entry is a protest another tablet recorded** (on the server, not in this tablet's outbox) voids it on the server. Owned by Task 3 (`server-entries` read).
5. **A protest whose answer was lost, then a reload** counts once on the chip (server row and waiting row joined on `client_uuid`), and the retry returns the saved row. Owned by Task 1 (server replay) and Task 3 (`protestCountFor`).

---

### Task 1: Server — table, doors, resets, registries

**Files:**

- Create: `packages/db/migrations/0276_match_protests.sql`
- Create: `packages/db/test/match-protests.test.ts`
- Create: `apps/api/src/modules/protests/{protests.module.ts,protests.controller.ts,protests.service.ts,dto/protests.dto.ts}`
- Create: `apps/api/src/modules/protests/protests.service.test.ts`, `protests.controller.reads.test.ts`
- Modify: `apps/api/src/app.module.ts` (import `ProtestsModule`)
- Modify: `apps/api/src/modules/staff/staff.service.ts:1034-1047` (generalise `authorizePenaltyScoring`)
- Modify: `apps/api/src/modules/phases/revert-match.ts:51-63`, `apps/api/src/modules/matches/matches.service.ts:1060-1065`
- Modify registries: `apps/api/src/modules/exports/archive.tables.ts:392-400` (+ `archive.migration-coverage.test.ts:198-208`, `archive.tables.test.ts:177-186`), `apps/api/src/modules/privacy/subject-export.tables.ts`, `subject-export.service.ts:71-79`, `apps/api/src/common/event-readonly/resolve-event-id.ts:85-86` (+ its test `:52`, `:262-267`), `archived-lock.routes.test.ts:80-121`, `apps/api/src/common/auth/public-routes.test.ts`, `scripts/lib/rls-probe-tables.mjs:88-92,257`, `packages/db/fixtures/rls-probe-seed.sql`, `scripts/db-cascade-probe.mjs:105-131`, `packages/db/fixtures/cascade-probe-seed.sql`, `docs/DATABASE_REVIEW.md:15,17`, `packages/api-client/src/generated/schema.ts` (regenerated)
- Modify tests that seed the reset tables: `matches/matches.service.test.ts:1051`, `matches/matches.reset-requests.test.ts:34,91`, `phases/match-completion.service.test.ts:225` (it also holds `revert-match`'s tests)
- Modify tests of the renamed authorizer: `staff/staff.service.authorize.test.ts:577-590`, `penalties/penalties.void-black-card.review.test.ts:13,20`
- Modify: `apps/api/src/modules/matches/match-locked.doors.test.ts:51-74` (per-file `matchLocked()` count: add `'modules/protests/protests.service.ts': N`). The protest doors refuse a locked bout with `matchLocked()`, so the pad reads the refusal by its code.
- Modify: `docs/ARCHITECTURE.md` — new `### 5.3a Protests` between §5.3 (`:402`) and §5.4 (`:430`); at `:1274` add `match_protests` to the listed Match tables and make "on the five" read "on the six" (the phrase "five Match tables" is only in `DATABASE_REVIEW.md:17`)

**Interfaces:**

- Produces:
  - Table `match_protests` (columns below), published to `supabase_realtime`.
  - `POST /api/v1/matches/:id/protests` body `{ clientUuid, sequence, registrationId, occurredAt, sentAt?, clockTimeMs? }` → `201` with the row.
  - `PATCH /api/v1/match-protests/:id/void` body `{ reason? }` → the voided row.
  - `GET /api/v1/matches/:id/protests` → `MatchProtestRow[]` (public, `[]` when the reader may not see the Match), ordered by `sequence`, voided rows included.
  - `StaffService.authorizeEntryScoring(req, table: 'match_penalties' | 'match_protests', entryId: string): Promise<ScoringActor>` (replaces `authorizePenaltyScoring`; both callers move).

- [ ] **Step 1: Write the migration pin test** `packages/db/test/match-protests.test.ts`, using `packages/db/test/migration-sql.ts` as `match-tables-api-only-writes.test.ts` does. Assertions: `ALTER TABLE match_protests ENABLE ROW LEVEL SECURITY` present; exactly one policy on the table, `FOR SELECT`, whose text contains `e.status IN ('published','running','completed')` and `t.status IN ('published','running','completed')` and no `is_org_member`; `REPLICA IDENTITY FULL`; `ALTER PUBLICATION supabase_realtime ADD TABLE match_protests` inside a guard; no `GRANT INSERT|UPDATE|DELETE`; every `REFERENCES` carries `ON DELETE CASCADE` or `ON DELETE SET NULL`.
- [ ] **Step 2: Run** `pnpm --filter @myclash/db test -- match-protests` → FAIL (file missing).
- [ ] **Step 3: Write `0276_match_protests.sql`.** Columns: `id uuid pk default gen_random_uuid()`, `client_uuid uuid not null unique`, `match_id → matches ON DELETE CASCADE`, `tournament_id → tournaments ON DELETE CASCADE`, `registration_id → registrations ON DELETE CASCADE`, `sequence integer not null`, `round_number integer not null default 1`, `clock_time_ms integer` (nullable), `occurred_at timestamptz not null`, `recorded_at timestamptz not null default now()`, `by_user_id uuid` (no FK, as `match_penalties`), `staff_account_id → event_staff_accounts ON DELETE SET NULL`, `voided boolean not null default false`, `voided_reason text`, `UNIQUE(match_id, sequence)`. Indexes (`IF NOT EXISTS`): `(match_id, voided, sequence)`, `(tournament_id, voided)`, `(registration_id, voided)`, `(staff_account_id)`. The read rule is the anon branch of `match_penalties_select` (`0200_tournament_status_public_switch.sql:180-194`) without the dead `is_org_member` branch, so no helper grant is needed. Realtime block copied from `0167_realtime_match_penalties.sql:29-46`.
- [ ] **Step 4: Run** the pin test → PASS; `pnpm db:migrations:replay` → exit 0; `pnpm db:review` → no new finding.
- [ ] **Step 5: Write the service tests** `protests.service.test.ts` on `mockSupabase` (`common/testing/supabase-chain.ts`; seed shape as `penalties.void-over-event.test.ts:22-56`, every filtered key seeded):
  - `a resend with the same clientUuid returns the saved row and writes nothing` (`db.writes` equals `[]`).
  - `a clientUuid saved on another bout is a 400`.
  - `the row is stamped with the bout's current_round, the actor's staff_account_id or by_user_id, and clock_time_ms ?? null` (assert the insert payload).
  - `a protest is taken while the bout awaits its round advance` (`awaiting_round_advance: true` → insert happens).
  - `a protest is taken on a completed bout`.
  - `a protest on a scheduled bout is refused 409 bout_not_started`.
  - `a protest older than the last reset is refused 409 scored_before_reset`.
  - `a protest on a locked bout is refused`; `on an over Event it is refused event_results_frozen for a scorekeeper and taken for a super admin`.
  - `a registration that is neither red nor blue is a 400`.
  - `recording or voiding a protest writes match_protests only` (`db.writes` lists no `matches`, `match_events` or `match_penalties` write; the service takes no scoring service at all).
  - `void: unknown id 404; already voided 400; locked bout refused; over Event super admin only; the update is {voided:true, voided_reason}`.
  - `the list read selects '*' from match_protests filtered on match_id and ordered by sequence` (assert via `selectsFor`/`filtersFor`).
- [ ] **Step 6: Write** `protests.controller.reads.test.ts`: `GET matches/:id/protests` returns `[]` when `canReadMatch` is false (mirror `penalties.controller.reads.test.ts`).
- [ ] **Step 7: Run** `pnpm --filter @myclash/api test -- protests` → FAIL.
- [ ] **Step 8: Implement the module.**
  - DTO `createProtestSchema` `.strict()`: `clientUuid: z.uuid()`, `sequence: z.number().int().min(1)`, `registrationId: z.uuid()`, `occurredAt: z.iso.datetime()`, `sentAt: z.iso.datetime().optional()`, `clockTimeMs: z.number().int().min(0).nullable().optional()`. `VoidProtestDto` = `{ reason: z.string().max(500).optional() }.strict()`.
  - `ProtestsService.createProtest(matchId: string, dto: CreateProtestDto, actor?: ScoringActor)` (`ScoringActor` from `staff.service.ts:97`; `PenaltyActor` is private to `penalties.service.ts:80`). Order: match context (read `matches` with `id, status, red_registration_id, blue_registration_id, phase_id, locked_at, current_round` → tournament → event org); org scorekeeper check unless a staff account or `correctsOverEvent`; replay by `client_uuid` (another bout → 400); `frozenResults.assertExchangeCreationAllowed`; locked unless `canOverrideLocked`; `assertBoutTakes(db, match, { occurredAt })`; red/blue check; insert; on a unique violation replay by `client_uuid`, otherwise 400. **Do not copy** `penalties.service.ts:941` (`awaitingRoundAdvance`).
  - `ProtestsService.voidProtest(protestId, dto, actor?)` and `listMatchProtests(matchId)` as above.
  - Controller decorators copied from `penalties.controller.ts:290-365`: list `@Public() @Throttle(PUBLIC_LIVE_READ_THROTTLE)`; create `@AllowOnArchivedEvent() @HttpCode(201)` via `staff.authorizeMatchScoring(req, id, 'leave-to-handler')`; void `@AllowOnArchivedEvent()` via `staff.authorizeEntryScoring(req, 'match_protests', id)`.
  - Share the match-context and scorekeeper helpers with `PenaltiesService` if they can be lifted as plain functions; otherwise the protests service reads only the columns above.
  - Constructor `(supabase: SupabaseService, frozenResults: FrozenResultsGuard, orgs: OrganizationsService)` with **no `@Optional()`** (unlike `penalties.service.ts:153-155`), so a missing import fails the boot test instead of silently skipping the over-Event refusal. `ProtestsModule` imports `SupabaseModule`, `FrozenResultsModule`, `OrganizationsModule`, `StaffModule`.
- [ ] **Step 9: Resets.** Add a `match_protests` void (same `update({voided:true, voided_reason: reason}).eq('match_id').eq('voided', false)`, error → `BadRequestException`) after the `match_penalties` void in both `revert-match.ts` and `MatchesService.resetMatch`. Tests: in `matches.reset-requests.test.ts:91` the write order becomes `['exchanges','match_penalties','match_protests','match_events','matches']`; add `a reset voids the bout's live protests` to `match-completion.service.test.ts` (the `revert-match` path) and to `matches.service.test.ts`.
- [ ] **Step 10: Registries.** Archive entry after `match_penalties`: `match_protests: { key: 'matchProtests', collect: { event: BY_MATCH_SCORING, tournament: BY_MATCH_SCORING }, freshClientUuid: true }` plus its EN+FR label; `FK_COLUMNS_NOT_REMAPPED` gains `match_protests.by_user_id` and `match_protests.staff_account_id`. Subject export: `match_protests: { reaches: [{ column: 'by_user_id', reach: 'uid' }], file: 'protests.csv', note }`, and `match_protests` in the `fetchByMatch` loop, whose table→file ternary (`subject-export.service.ts:71-76`) becomes a map so protests land in `protests.csv`, not `matches.csv`; test: a subject's protests are in `protests.csv`. `EVENT_OF['match-protests']` as `'match-penalties'`. Archived-lock list gains `'POST matches/:id/protests'` and `'PATCH match-protests/:id/void'`; public-routes list gains `'GET /matches/:id/protests'`. RLS probe: a seed row on the public Match `dddddddd-…-0a`, a `VERDICTS` line (visible) and an `API_ONLY_WRITES` line. Cascade probe: a seed row and a `SEEDED` line. `DATABASE_REVIEW.md:15,17`: name the protest in the seed sentence and make "five Match tables" six.
- [ ] **Step 11: Run** `pnpm --filter @myclash/api test` (full, not filtered: `route-authz.test.ts` must still read UNDECIDED 0 / FALSE_PASSES 0 / DECIDED_ELSEWHERE 19), `pnpm openapi:emit && pnpm openapi:client`, then the `myclash-gates` chain. Expected: all green; `pnpm db:rls-probe` and the cascade probe list the new table.
- [ ] **Falsify** (scratch copy, assert the source changed, compare the collected count): copy the card's `awaitingRoundAdvance` refusal into `createProtest` → the between-rounds test reds; add a `matches` update in `createProtest` → the writes-only test reds; keep the injection required and drop `FrozenResultsModule` from `ProtestsModule`'s imports → `app.module.boot.test.ts` reds (it is the only provider of the guard; `StaffModule` and `OrganizationsModule` do not export it; with `@Optional()` Nest would inject `undefined` and boot, which is why the injection stays required); drop the protests void from `MatchesService.resetMatch`, then from `revert-match.ts` → each reset test reds; drop the replay by `client_uuid` → the resend test reds.
- [ ] **Step 12: Write §5.3a in `docs/ARCHITECTURE.md`:** what a protest is, the table, that it shares the pad's counter but not the database's uniqueness, that it never reaches the score, the reset rule, and the read rule.
- [ ] **Step 13: Commit** `feat(protests): a protest is its own entry of the Match, kept by the API`.

---

### Task 2: History — the protest row on every screen

**Files:**

- Modify: `packages/ui/src/types/match-events.ts` (add `MatchProtest` beside `Penalty`), `packages/ui/src/index.ts:318-324` and `hooks/useLiveMatch.ts:13-21` (re-export)
- Modify: `packages/ui/src/utils/exchange-timeline.ts:24-70,144-151,163-280`
- Modify: `packages/ui/src/components/MatchTimeline.tsx:194-266`
- Modify: `packages/ui/src/hooks/live-match-read.ts:26-65`, `packages/ui/src/hooks/useLiveMatch.ts:195-243`
- Modify: `apps/web-public/app/e/[eventSlug]/match/[matchId]/{page.tsx:73-79,match-live-view.tsx:176-198,312-319,use-match-live-channel.ts:245-273}`
- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/live/BoardRowTimeline.tsx`, `packages/ui/src/components/TVScoreboard.tsx:610-632` (its builder call passes `live.protests`; the chip is Task 5)
- Modify browser stubs so the new read is answered (`[]` unless a story needs rows): `tests/a11y/tv-stub.ts:98-100`, `pad-clock-stub.ts`, `pad-rounds-stub.ts`, `pad-piste-stub.ts`, `pad-penalty-stub.ts`, `public-pages-stub.ts`
- Modify (pad, server rows only): `apps/web-staff/src/offline/kept-bout.ts:27,94-101`, new `apps/web-staff/src/hooks/useProtests.ts` (mirror of `useExchanges.ts`), `hooks/useMatchScoringData.ts:51-102,144-145`, `components/ScoringCenterControls.tsx:247-275,560,570`, `components/MatchResultOverlay.tsx:211-259`, `components/MatchCorrectionsDrawer.tsx:129-151`, `lib/undone-line.ts:27-64`
- Modify: `packages/i18n/src/messages/{en,fr}/scoring.ts`
- Test: `packages/ui/src/utils/exchange-timeline.test.ts`, new `packages/ui/src/components/MatchTimeline.render.test.tsx` (`renderToStaticMarkup`), `packages/ui/src/hooks/live-match-read.test.ts`, `apps/web-staff/src/lib/undone-line.test.ts`, `apps/web-staff/src/offline/kept-bout.test.ts`, `apps/web-staff/src/components/scoring-center.screens.test.ts` (text pin, create if absent)
- Modify: `apps/web-staff/src/hooks/scoring-data-single-reader.test.ts:46-63` — add `{ hook: 'useProtests', module: 'useProtests', owner: 'src/hooks/useMatchScoringData.ts' }`, so a second reader of `useProtests` cannot add a per-hit request unnoticed.

**Interfaces:**

- Consumes: `GET /api/v1/matches/:id/protests` (Task 1); the realtime publication of `match_protests` (Task 1).
- Produces:
  - `interface MatchProtest { id: string; client_uuid: string; match_id: string; registration_id: string; sequence: number; round_number: number | null; clock_time_ms: number | null; occurred_at: string; voided: boolean; pending?: boolean }`.
  - `UnifiedEvent.kind: 'exchange' | 'penalty' | 'protest'`; `UnifiedEvent.number: number | null` (null only for a protest); id `pro-<id>`.
  - `BuildTimelineArgs.protests: MatchProtest[]` (required).
  - `LiveMatch.protests: MatchProtest[]` from `useLiveMatch`.
  - Pad: `MatchScoringData.activeProtests: MatchProtest[]` (server rows, not taken back); `BoutListName` gains `'protests'`.

- [ ] **Step 1: Write the timeline tests** in `exchange-timeline.test.ts`:
  - `a protest row carries no number, and the hits and cards around it keep theirs` — 4 exchanges + 1 card + 1 protest at a time between exchange 2 and 3: numbers equal the same build without the protest; the protest row has `number === null`, `kind === 'protest'`, `delta` null (a truthy delta is appended by `exchangeOptionLabel`, `exchange-timeline.ts:279`), `typeLabel` `t('scoring.lice.eventRowProtest')`.
  - `a protest takes its place by time, then by sequence`.
  - `a voided protest is dropped`; `a pending protest carries pending: true`.
  - `exchangeOptionLabel never prints #null` for a protest row.
  - `buildBoutFlow` unchanged: an existing test passes untouched (it never receives protests).
  - `kept-bout.test.ts`: `readBoutList('protests')` answers from the kept copy offline; `forgetBout` clears the protests list with the other two.
  - Falsify after Step 5: number protests like the others → the "keep theirs" test reds; render `#{ev.number}` unconditionally → the render test reds; drop the protests binding in `useLiveMatch` → `pnpm db:realtime-bindings` still passes, so hold the binding with a text pin in `live-match-read.test.ts` that the source binds `match_protests`.
- [ ] **Step 2: Write** `MatchTimeline.render.test.tsx`: a protest row renders no `#` text and no `data-event-number` attribute; a hit row still renders `#1`; with `highlightNumber` null no protest row carries the active class (`MatchTimeline.tsx:200` compares `ev.number === highlightNumber`, and `null === null`).
- [ ] **Step 3: Write** `live-match-read.test.ts` case `reads the bout, its cards, its protests, its exchanges and its clock` (the fifth URL is `/matches/:id/protests`).
- [ ] **Step 4: Run** `pnpm --filter @myclash/ui test` → FAIL.
- [ ] **Step 5: Implement** in `exchange-timeline.ts`: number exchanges and cards with `ascendingWithNumbers` exactly as today, then merge protest rows (`number: null`) with the same comparator (time, then `seq`), then reverse. `MatchTimeline` renders the number cell and `data-event-number` only when `ev.number !== null`; highlighting keys off `ev.number` only for numbered rows. `exchangeOptionLabel` omits `#N` when null. `readLiveMatch` adds the protests read; `useLiveMatch` adds a fifth `.on('postgres_changes', { event: '*', table: 'match_protests', filter: match_id=eq.<id> }, scheduleRefresh)`.
- [ ] **Step 6: Callers.** Public page: `fetchProtests` in SSR, in `refreshLive`, and a realtime binding in `use-match-live-channel.ts` merging `payload.new` by `id` as the card binding does. Live room: pass `live.protests`. Pad: `useProtests(matchId)` reads through `readBoutList('protests')`; `useMatchScoringData` exposes `activeProtests` through `notTakenBack`; `ScoringCenterControls` passes them to the builder, the "Exchanges: N" label counts `events.filter(e => e.kind !== 'protest').length`, Undo stays `events.length === 0`; `MatchResultOverlay` and `MatchCorrectionsDrawer` pass `activeProtests`; `undone-line.ts` names an undone protest `t('scoring.lice.undoneProtest', { fighter })`.
- [ ] **Step 7: i18n** (EN / FR): `scoring.lice.eventRowProtest` "Protest" / "Réclamation"; `scoring.lice.undoneProtest` "Protest by {fighter}" / "Réclamation de {fighter}".
- [ ] **Step 8: Run** `pnpm --filter @myclash/ui build && pnpm --filter @myclash/ui test`, `pnpm --filter @myclash/web-staff test`, `pnpm -F @myclash/i18n test` (prints `✓ all N t() key references resolve`), `pnpm typecheck`, `pnpm db:realtime-bindings`, `pnpm test:e2e` (whole browser suite, for the stubs) → all green.
- [ ] **Step 9: Commit** `feat(timeline): a protest is a row of the Match history, with no number`.

---

### Task 3: Pad — the protest button, offline, undo, held inbox, frozen

**Files:**

- Modify: `apps/api/src/modules/matches/match-summaries.ts:131,195-240` (`events` read gains `status`; summary gains `eventOver`), its test
- Modify: `apps/web-staff/src/lib/bout-read.ts:77-93,127-165` (`BoutSummary.eventOver?`, `MatchInfo.eventOver`)
- Create: `apps/web-staff/src/lib/protest-button.ts` + `.test.ts`
- Create: `apps/web-staff/src/components/ProtestButton.tsx` (the one button, used on the pad, the round-break screen and the result screen), `apps/web-staff/src/hooks/useProtestTap.ts` (the one tap handler)
- Modify: `apps/web-staff/src/offline/db.ts:48,63-73,156-172`, `offline/outbox.ts` (`queueProtest`), `offline/sync.ts:276-314,381-395`, `offline/pending-events.ts:151-237`, `lib/server-entries.ts:7,43-54`, `lib/void-entry.ts:17-25`, `lib/held-hit.ts:96-108,143-158,245-260`, `components/QuarantineInbox.tsx:53-69`, `components/ScoringColumn.tsx:322-345`, `components/MatchView.tsx:513-519`, `components/MatchPauseDialogs.tsx` (`RoundBreakDialog`), `components/MatchResultOverlay.tsx`, `components/ScoringCenterControls.tsx:249-255`, `lib/undone-line.ts`, `hooks/useMatchScoringData.ts:154-180`
- Modify: `docs/ARCHITECTURE.md` §10.2 (`:1320-1330`): `'protest'` in the outbox kinds
- Modify tests that pin request counts: `offline/drill-census.test.ts` (`server-entries.ts` → `padRequest 4`, `sync.ts` fetch counts, the door list), `lib/clear-last.undo.test.ts:59-72,93`, `tests/a11y/pad-penalty-stub.ts:94-99`
- Modify: `tests/a11y/pad-rounds-stub.ts` — record each `POST /protests` body and serve those rows on `GET /protests` (as `pad-penalty-stub.ts` does). Without it the stub answers the POST with `{}` (`:295`) and `GET /protests` with `[]`, so a drained protest leaves the outbox and the chip falls back to `0`.
- Test: new `offline/protest.test.ts`, `offline/pending-events.test.ts`, `offline/sync.round.test.ts:76-82`, `lib/clear-last.undo.test.ts`, `components/protest-chip.screens.test.ts`
- Modify: `tests/e2e/06-offline-sync.spec.ts` (a protest step)
- Modify: `packages/i18n/src/messages/{en,fr}/scoring.ts`

**Interfaces:**

- Consumes: Task 1 doors; Task 2 `MatchProtest`, `activeProtests`, `BoutListName 'protests'`.
- Produces:
  - `OutboxKind` gains `'protest'`; `isTap('protest') === false`.
  - `queueProtest(p: { matchId: string; sequence: number; registrationId: string; clockTimeMs: number | null; round: number; bout: BoutNames; cardedColor: 'red' | 'blue' }): Promise<number>` (the shape of `queueCard`, `outbox.ts:64-74`).
  - `pendingRowsForMatch(...)` takes `serverProtests` beside the server cards and its result gains `protests: MatchProtest[]` (each `pending: true`, deduped against the server rows by `client_uuid`, as cards are at `pending-events.ts:150-153`).
  - `protestCountFor(args: { server: MatchProtest[]; pending: MatchProtest[]; registrationId: string }): number` in `pending-events.ts` (counts an already-deduped list); `MatchScoringData.pendingProtests` and `scoring.protestCountFor(registrationId)` bound in `useMatchScoringData`.
  - `useProtestTap(args: { match: MatchInfo; nextSequence: number; submit: { bout: BoutNames; round: number }; clockTimeMs: () => number | null; syncEngine; onRecorded: () => void }): (corner: 'red' | 'blue') => Promise<void>` — queues, `sendBehind()`, moves the sequence on. Task 4 wraps it in `ScoringColumn` with the offer (the break screens never offer: no card is live there).
  - `ProtestButton` props `{ count: number; fighterName: string; disabled: boolean; onTap: () => void; size: 'pad' | 'dialog' }`.
  - `protestButtonLive(args: { boutStatus: string; lockedAt: string | null; eventOver: boolean }): boolean` — true only for `running | paused | completed`, not locked, not over.
  - `ServerRow.kind` and `ServerEntry` gain `'protest'`; `VOID_PATH.protest = '/api/v1/match-protests/:id/void'`.
  - `MatchInfo.eventOver: boolean`.

- [ ] **Step 1: API summary test:** `the summary says eventOver true for a completed or archived Event, false otherwise`, and the `events` select string contains `status`.
- [ ] **Step 2: Pad tests, written first:**
  - `protest-button.test.ts`: `scheduled` → false; `running`, `paused`, `completed` → true; any status with `lockedAt` → false; `eventOver` → false.
  - `bout-read` test: `eventOver` copied from the summary; a missing summary gives `false`.
  - `protest.test.ts` (fake-indexeddb, `vi.stubGlobal('fetch')`, as `direct-card.test.ts`): `a protest tapped offline is in the outbox before any network call`; `it drains once to POST /matches/:id/protests with { clientUuid, sequence, registrationId, occurredAt, sentAt, clockTimeMs }`; `a 400 retries once under a fresh sequence read from exchanges, penalties and protests`; `a 409 event_results_frozen is held and its line names the fighter` (`heldWhoLine` → `scoring.quarantine.protestBy {"who":…}`); `a protest behind a held card of the same bout waits, and is counted`.
  - `pending-events.test.ts`: `queued({kind:'protest'})` becomes a protest row, never an exchange, and adds nothing to `provisionalDeltas`; `protestCountFor` counts a protest held on the server and waiting on the tablet once (same `client_uuid`); a voided server protest is not counted.
  - `sync.round.test.ts`: `isTap('protest')` is false.
  - `clear-last.undo.test.ts`: `undo takes a protest that is the newest entry, on the tablet and with PATCH /match-protests/:id/void`; `undo voids a protest recorded by another tablet` (server row only); `after a card given from the offer, the first undo takes the card and the second the protest`. `BOUT_READ` becomes the 4 reads.
  - `protest-chip.screens.test.ts` (text pin): `ProtestButton.tsx` is a `<button` with `data-testid="protest-chip"`, `data-count`, an `aria-label` from `scoring.lice.protestButtonLabel`, a `min-h-[44px]` touch size (as `ScoringColumn.tsx:473`), and no raw palette class; `ScoringColumn.tsx`, `MatchPauseDialogs.tsx` (`RoundBreakDialog`) and `MatchResultOverlay.tsx` each render `<ProtestButton` for both fighters; `ScoringColumn` passes `disabled={!protestLive || readOnly}`; `ScoringCenterControls` passes `pendingProtests` to `buildUnifiedTimeline`. `MatchResultOverlay` keeps its server-rows-only rule (`MatchResultOverlay.tsx:208-211`): its history gets `activeProtests` only (Task 2), never `pendingProtests`, and no protest reaches `buildBoutFlow`. Its protest buttons still count server + waiting rows through `scoring.protestCountFor`.
  - Browser spec `tests/a11y/pad-protest-break-screens.spec.ts` on `pad-rounds-stub.ts`: with the round-break screen up, tapping a protest button inside it sends exactly one `POST /protests` and the button reads `1`; on the result screen after the last round, the same; offline, a protest that is the only entry of the bout shows in the history and leaves "Undo last entry" enabled.
- [ ] **Step 3: Run** `pnpm --filter @myclash/api test -- match-summaries` and `pnpm --filter @myclash/web-staff test` → FAIL.
- [ ] **Step 4: Implement.** Widen `OutboxKind`, then work the compiler's list (`isTap`, `postExchange` switch → `postProtest`, `heldWhat`, `DISCARD_WORDS`, `entryLabel`, `undoLanded`, `VOID_PATH`). Then the four hand-listed places: the `pending-events.ts:181-211` branch, `freshSequence` (third read), `server-entries.readAll` (fourth read, `ServerRow` widened), `kept-bout` (done in Task 2), plus `heldWhoLine`. `MatchView` computes `protestLive = protestButtonLive({ boutStatus, lockedAt: match.lockedAt, eventOver: match.eventOver })` and passes it to `ScoringColumn`. The chip sits after the card chips in the row at `ScoringColumn.tsx:322-345`, `bg-surface text-foreground-secondary border border-border`, icon `Hand` from `lucide-react`, text = count. A tap goes through `useProtestTap` (the one tap handler; `ScoringColumn` passes `clockTimeMs: () => clockTimeMs`, a getter read at tap time, and `onRecorded: onPenaltyRecorded`): `queueProtest({...})` with `sequence: nextSequence`, then `syncEngine?.sendBehind()`, then `onRecorded()` (moves the sequence on). No question.
- [ ] **Step 5: i18n** (EN / FR): `scoring.lice.protestButtonLabel` "Record a protest by {fighter}" / "Enregistrer une réclamation de {fighter}"; `scoring.lice.protestsChipTooltip` "Protests by {fighter}" / "Réclamations de {fighter}"; `scoring.quarantine.typeProtest` "Protest" / "Réclamation"; `scoring.quarantine.protestBy` "Protest by {who}" / "Réclamation de {who}"; the `DISCARD_WORDS.protest` key in the shape of its neighbours.
- [ ] **Step 6: Offline browser spec (CI).** `tests/a11y/` is what CI runs (`pnpm test:e2e` = `scripts/run-e2e.mjs`, root `playwright.config.ts` ignores `tests/e2e`). New `tests/a11y/pad-protest-no-network.spec.ts` on `pad-penalty-stub.ts` (extended to answer `GET`/`POST /protests`), offline = the 503 body `{ error: 'offline', status: 503 }` and `navigator.onLine` false: tap the red protest chip; the outbox holds one `kind: 'protest'` row and no `/protests` POST reached the stub; the chip reads `1`; reload, the chip still reads `1`; dispatch `online`; the POST list is exactly one protest call with that `clientUuid`; the chip still reads `1`. A second case: the chip is `disabled` on a locked bout and on a summary with `eventOver: true`.
- [ ] **Step 7: Prod offline E2E (after the operator's redeploy).** In `tests/e2e/06-offline-sync.spec.ts`, after step 2c: tap the red fighter's protest chip offline, read the outbox (one `kind: 'protest'` row), reconnect, poll `GET /matches/:id/protests` until it holds exactly one live row. This suite runs only against a deployed app (`pnpm test:e2e:prod`, `tests/e2e/README.md`); hand it to the operator with the push.
- [ ] **Step 8: Falsify.** One at a time, each in a scratch copy and asserted to have changed the source before running: drop the protest branch in `pending-events.ts` → the pending test reds; drop the `/protests` read in `server-entries.ts` → the other-tablet undo test reds; make `isTap('protest')` true → `sync.round.test.ts` reds; drop `eventOver` from `protestButtonLive` → its test reds. Restore and confirm the collected test count matches the baseline.
- [ ] **Step 9: Run** `pnpm --filter @myclash/web-staff test`, `pnpm --filter @myclash/api test`, `pnpm -F @myclash/i18n test`, `pnpm typecheck`, `pnpm test:e2e` (the runner forwards no file filter, `scripts/run-e2e.mjs:213`; it runs the whole browser suite) → all green.
- [ ] **Step 10: Commit** `feat(pad): the scorekeeper records a protest, offline, with undo`.

---

### Task 4: Limit and offer

**Files:**

- Modify: `packages/types/src/scoring-config.ts:82-93` (+ `protestRulesOf`), its test
- Modify: `apps/api/src/modules/events/tournament-config.ts:29-56`, `tournament-config.test.ts`; typed fixtures `ruleset-defaults.ts:258`, `create-tournament.fixtures.ts:38`, `rules-write.fixtures.ts:45`
- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/_shared/display-form.ts:24-56` + test; `.../settings/_components/DisplayTab.tsx:447-480`; `.../settings/page.rules.test.tsx:142`; `.../settings/page.fixtures.ts:16`
- Create: `packages/ui/src/utils/protest-chip.ts` + test (shared with Task 5)
- Create: `apps/web-staff/src/lib/protest-offer.ts` + test
- Modify: `apps/web-staff/src/components/ProtestButton.tsx` (text and warning), `ScoringColumn.tsx` (the offer through `AskFirstDialog`), `MatchView.tsx`/`MatchPauseDialogs.tsx`/`MatchResultOverlay.tsx` (pass the limit to the button)
- Create: `tests/a11y/pad-protest-offer.spec.ts`; modify `tests/a11y/pad-penalty-stub.ts` (let a spec answer `/tournaments/:id/match-config` and the penalty ruleset with its own values)
- Modify: `packages/i18n/src/messages/{en,fr}/{scoring,organizer}.ts`

**Interfaces:**

- Consumes: Task 3 chip, `protestCountFor`, `protestLive`, `submitPenalty`, `listedCard`, `scoring.resolveCard`.
- Produces:
  - `TournamentDisplayConfig.protests?: { limit: number | null; offerPenaltyRef: string | null }`.
  - `protestRulesOf(display: TournamentDisplayConfig | null | undefined): { limit: number | null; offerPenaltyRef: string | null }` — absent → both null. The one reader; pad, TV and admin use it.
  - `protestChipText(count: number, limit: number | null): string` → `"2"` or `"2/2"`; `protestAtLimit(count: number, limit: number | null): boolean` → `limit !== null && count >= limit`.
  - `protestOffer(args: { countAfterTap: number; limit: number | null; offerPenaltyRef: string | null; entries: PenaltyRulesetEntry[]; cardEntryLive: boolean }): PenaltyRulesetEntry | null` — matches `String(e.ref_number) === offerPenaltyRef`.
  - `DisplayState.protestLimit: string` (`''` = no limit), `DisplayState.protestOfferRef: string | null`.

- [ ] **Step 1: Tests first.**
  - `protestRulesOf({ sideColors })` → `{ limit: null, offerPenaltyRef: null }`.
  - Normaliser: keeps `{ limit: 2, offerPenaltyRef: '8' }` and `{ limit: 2, offerPenaltyRef: 'R7a' }`; keeps `{ limit: null, offerPenaltyRef: null }`; omits the key when absent; a negative or fractional limit, a non-string or empty ref, or a ref over 20 characters → `BadRequestException`; `deepMergeJson` then normalise with `limit: null` clears a stored 2.
  - `display-form`: `displayForm` of a Tournament without `protests` gives `protestLimit ''` and `protestOfferRef null`; `displayBody` sends `protests: { limit: 3, offerPenaltyRef: '8' }` for `'3'` and `{ limit: null, … }` for `''`.
  - `page.rules.test.tsx` Display tab: the two fields render; a limit with no penalty shows `organizer.tournaments.settings.protestNoOfferNote`.
  - `protest-chip.test.ts`: `(2, null)` → `"2"`; `(2, 2)` → `"2/2"`; at-limit true for 2/2 and 3/2, false for 1/2 and for `null`.
  - `protest-offer.test.ts` (entries with string refs, as the API sends them, `penalties.service.ts:311`): limit 2 → null at 2, entry at 3 and at 4; limit 0 → entry at 1; limit null → null; ref null → null; ref `'R7a'` matches an entry whose `ref_number` is `'R7a'`; ref not in `entries` → null; `cardEntryLive` false → null.
  - `pad-protest-offer.spec.ts` (stubbed browser; record only the bout's calls; end with one known call; this spec answers the penalty ruleset with string refs and `/tournaments/:id/match-config` with `display.protests = { limit: 2, offerPenaltyRef: '8' }`): the third tap opens the dialog naming the fighter, "Contestation abusive" and the resolved card; "No" → the POST list is exactly 3 protests; "Yes" on a fourth tap → exactly one `POST /penalties` with `rulesetEntryId` of ref `'8'` and no second dialog; the chip reads `3/2` with the warning class. On `pad-rounds-stub.ts`, whose `/match-config` (`rulesOf`, `:301`) this task makes answer `display.protests = { limit: 2, offerPenaltyRef: '8' }` for this spec: a third protest tapped on the round-break screen is recorded and opens no dialog.
- [ ] **Step 2: Run** each package's tests → FAIL.
- [ ] **Step 3: Implement.** Type and `protestRulesOf` in `scoring-config.ts`. The normaliser parses `display.protests` beside `quickPenalties`, `BadRequestException` in the style of `parseSideColor`. Admin: two fields below the quick-pick block, the penalty select lists the same entries as the quick-picks, valued by `String(e.ref_number)`, plus "None"; the note shows when `protestLimit !== ''` and `protestOfferRef === null`. The wizard shares `DISPLAY_FORM`; it renders nothing new and its defaults send `{ limit: null, offerPenaltyRef: null }`. Pad: chip text `protestChipText`, warning `bg-warning/20 text-warning border-warning` when `protestAtLimit`. `ProtestButton` (all three places) shows `protestChipText` and the warning. In `ScoringColumn`, a tap reads `countBefore = scoring.protestCountFor(registrationId)`, awaits the Task 3 tap, then `protestOffer({ countAfterTap: countBefore + 1, …, cardEntryLive: scoringEnabled })`; an entry opens `AskFirstDialog` (Cancel first) whose confirm calls `submitPenalty(listedCard(entry))` directly (not `pickPenalty`, which would ask again for red).
- [ ] **Step 4: i18n** (EN / FR): `scoring.lice.protestOfferTitle` "Protest limit passed" / "Limite de réclamations dépassée"; `scoring.lice.protestOfferBody` "Give {penalty} ({card}) to {fighter}?" / "Donner {penalty} ({card}) à {fighter} ?" (`{card}` from `cardWord`); `scoring.lice.protestOfferConfirm` "Give the card" / "Donner le carton"; `organizer.tournaments.settings.protestLimit` "Protest limit" / "Limite de réclamations"; `protestLimitHelp` "Per fighter, per Match. Empty: no limit." / "Par combattant, par match. Vide : pas de limite."; `protestOfferPenalty` "Penalty offered past the limit" / "Pénalité proposée au-delà de la limite"; `protestOfferNone` "None" / "Aucune"; `protestNoOfferNote` "The pad will count and warn, and offer no penalty." / "La tablette comptera et avertira, sans proposer de pénalité."
- [ ] **Step 5: Run** `pnpm --filter @myclash/types build`, `pnpm --filter @myclash/ui build`, then the tests of types, ui, api, web-admin, web-staff, `pnpm -F @myclash/i18n test`, `pnpm typecheck`, `pnpm test:e2e` (whole browser suite) → all green. Falsify: make `protestOffer` ignore `cardEntryLive` → the unit case "`cardEntryLive` false → null" in `protest-offer.test.ts` reds (the break-screen browser case never calls `protestOffer`, so it cannot catch this); route the "Yes" through `pickPenalty` → the "no second dialog" case reds.
- [ ] **Step 6: Commit** `feat(protests): a protest limit per Tournament, and the pad offers its penalty`.

---

### Task 5: TV scoreboard chip

**Files:**

- Create: `packages/ui/src/components/TvProtestChip.tsx` (exported; `FighterColumn` is private and takes no `t`, `TVScoreboard.tsx:436-452`, and a static render of `TVScoreboard` runs no effects, so the chip is tested on its own)
- Modify: `packages/ui/src/components/TVScoreboard.tsx:240-282,436-497`
- Test: new `packages/ui/src/components/TvProtestChip.render.test.tsx` (`renderToStaticMarkup`)

**Interfaces:**

- Consumes: `LiveMatch.protests` (Task 2), `protestRulesOf`, `protestChipText`, `protestAtLimit` (Task 4), `match.scoringConfig.display` (raw stored JSON from `GET /matches/:id/display`, read as optional).
- Produces: `TvProtestChip` props `{ protests: MatchProtest[]; registrationId: string; limit: number | null; fighterName: string; t: (key: string, params?: Record<string, string>) => string }` (the `t` shape of `MatchTimeline.tsx:60`); `FighterColumn` gains `protests`, `protestLimit` and `t`.

- [ ] **Step 1: Tests on `TvProtestChip`:** 2 live protests and 1 voided for this fighter, limit null → text `2`; limit 2 → `2/2` with the warning class; the other fighter's protests are not counted; the class string carries `stage-foreground` and `warning` tokens and no raw palette class. And `protestRulesOf` of a config without `protests` (Task 4) feeds `limit: null`.
- [ ] **Step 2: Run** `pnpm --filter @myclash/ui test -- TvProtestChip` → FAIL.
- [ ] **Step 3: Implement** the chip, mounted after the card chips in `FighterColumn`: `rounded-full px-4 py-1.5 text-stage-club`, neutral `bg-stage-foreground/10 text-stage-foreground`, at the limit `bg-warning/20 text-warning`, `Hand` icon, `title` from `scoring.lice.protestsChipTooltip`. The TV renders under the light token scope (no `data-theme`, `MatchTimeline.tsx:118-120`), so `--color-warning` is `#b45309` on `--color-stage` `#030712`: check the at-limit contrast in the browser and, if under 3:1 at `text-stage-club` size, use `text-warning` on `bg-stage-foreground/10` instead of `bg-warning/20`. Live updates come from Task 2's binding; a changed limit shows when the bout next changes (accepted, see the calls above). Falsify: drop the voided filter → its test reds.
- [ ] **Step 4: Run** `pnpm --filter @myclash/ui build && pnpm --filter @myclash/ui test`, `pnpm typecheck` → green.
- [ ] **Step 5: Commit** `feat(tv): the scoreboard shows each fighter's protests`.

---

### Task 6: Statistics — fighter, referee, Event

**Files:**

- Modify: `apps/api/src/modules/fighters/referee-stats.ts:43-47,119,150-255`, `fighters.service.ts:903-934,1096-1140,1733-1764` (`getRefereeStatsForPerson`, where the card read is wired), `1977-2011`
- Modify: `packages/rules/src/results/fighter-career.ts:55-85,347-365,418`
- Modify: `apps/api/src/modules/event-stats/{event-stats.service.ts:282-366,dto/event-stats.dto.ts:62-69}`; `apps/web-admin/src/components/statistics/{types.ts:57,RefereeWorkloadTable.tsx}`
- Modify: `apps/web-public/app/profile/referee/RefereeProfileClient.tsx:107-169,376-385`, `apps/web-public/src/lib/referee-tree.ts:12`, `apps/web-public/app/profile/fighter/FighterProfileClient.tsx:147,189,1578-1904`
- Test: `referee-stats.test.ts`, `fighters.service.test.ts`, `packages/rules/src/results/fighter-career.test.ts`, `event-stats.service.test.ts`, `apps/web-public/src/lib/referee-tree.test.ts`
- Modify: `packages/i18n/src/messages/{en,fr}/{organizer,publicApp}.ts`

**Interfaces:**

- Produces:
  - `RefereeProtestInput { matchId: string; voided: boolean }`; `protestsFacedBy(declarantMatchIds: ReadonlySet<string>, protests: RefereeProtestInput[]): { total: number; byMatch: Map<string, number> }` in `referee-stats.ts`.
  - `RefereeHistoryEntry.protests: number` (private part only).
  - `RefereeWorkloadRow.protests: number`.
  - `CareerProtestInput { registrationId: string }`; `FighterProtest { eventKey: string; eventId: string; eventName: string; weapon: string }`; `FighterCareer.protests?: FighterProtest[]`, present only with `includePenalties`.
  - `fetchRefereeProtests(matchIds)` → `select('match_id, voided')`; `fetchFighterProtests(registrationIds)` → `select('registration_id, voided')` with `.eq('voided', false)`; `getEventProtests(tournamentIds)` → `select('match_id, voided')` with `.eq('voided', false)`.

- [ ] **Step 1: Tests first.**
  - `protestsFacedBy`: counts only declarant Matches; skips voided.
  - `buildRefereeStats` with `includePrivateDetails` → each history entry carries `protests`; without it → `JSON.stringify(result)` contains no `protest`.
  - `getRefereeStatsBySlug` (public) payload contains no `protest`; `/me/referee-stats` history carries the count. Assert the select strings.
  - `fighter-career`: protests enriched with event and weapon through the registration; absent without `includePenalties`; a card total unchanged by any number of protests.
  - `event-stats`: `aggregates event-wide referee workload (matches, roles, cards, protests) per referee` — completed Matches only, voided protests excluded, declarant only.
  - `referee-tree.test.ts`: history totals sum `protests` per Event scope.
- [ ] **Step 2: Run** the API, rules and web-public tests → FAIL.
- [ ] **Step 3: Implement** the reads and builders above. `fetchRefereeProtests` runs only when `includePrivateDetails` is true: the card read at `fighters.service.ts:1742` also serves the public slug path, and `fighters.referee-stats.drafts.test.ts:60-68` runs `getRefereeStatsBySlug` on the strict mock, which throws on an unseeded table (`supabase-chain.ts:125-130`). Test: the public slug path reads no `match_protests`. Private referee page sums `history[].protests` in the same scoped loop as cards and shows it beside "cards issued". Fighter dashboard shows the count of `scopedProtests` (filtered by `inEvent` and `inWeapon`) under "penalties received". Event statistics table gains a "Protests" column after cards.
- [ ] **Step 4: i18n** (EN / FR): `publicApp.fighterProfile.protestsMade` "Protests made" / "Réclamations faites"; `publicApp.fighterProfile.protestsFaced` "Protests faced" / "Réclamations reçues"; `organizer.eventStats.referees.colProtests` "Protests" / "Réclamations".
- [ ] **Step 5: Run** `pnpm --filter @myclash/rules build`, the tests of api, rules, web-public, web-admin, `pnpm -F @myclash/i18n test`, `pnpm typecheck` → green.
- [ ] **Falsify:** move the count to a top-level `RefereeStats.protestsFaced` → the public-payload test reds; drop `.eq('voided', false)` from `getEventProtests` → the voided case reds (assert the filter with `filtersFor`, the double ignores it otherwise).
- [ ] **Step 6: Commit** `feat(stats): protests in the fighter, referee and Event statistics`.

---

## After the last task

- The full `myclash-gates` chain, coverage and the E2E suite, then push.
- By hand on the test Event: tap protests on a tablet in airplane mode, reconnect, watch the TV chip and the public history follow.
- A memory note `project_protest_counter_slice.md` and its `MEMORY.md` line.
