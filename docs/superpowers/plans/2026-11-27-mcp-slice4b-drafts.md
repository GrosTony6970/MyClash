# MCP slice 4b — drafts from Claude, shown in plain words (plan)

Spec: `docs/superpowers/specs/2026-11-24-mcp-server-design.md`, "Slice 4 — organiser writes"
(ruling 989). Branch `feat/mcp-writes`, worktree `.claude/worktrees/mcp-writes`, on top of slice 4a
(ruling 991: one merge at the end; ruling 992: the branch stays local until all the coding is done).
Recon: `.superpowers/sdd/2026-11-27-mcp-slice4b-drafts/recon.md` (file:line for every fact below).

## What the organiser gets

Marie runs the Longsword Open. In Claude she types "make 4 Pools in the Longsword Open, keep clubs
apart". Claude calls `draft_pools`. MyClash saves a draft and answers with its names (the Tournament, 4
Pools, clubs kept apart) and a link; Claude tells Marie in her words. Nothing has changed in the Event yet. Marie opens
the link. The assistant page opens that one draft and shows it in words: no JSON, no ids. She
presses Apply, and MyClash generates the Pools, as it does for a draft made in the app today.

The same for "create a Tournament Sabre Open", "make the bracket of the Longsword Open, top 16",
and "put LSW-P2-M04 on Piste 2 at 14:30". The chat page's proposal card shows a draft in the same
plain words (ruling 995).

## Rulings

- **989** — 4b first makes the assistant page open one draft from a link and show it in plain words
  (names, never ids), then adds Claude's four draft tools.
- **991** — 4b is built on `feat/mcp-writes` before any merge. **992** — local until the end.
- **993 (2026-11-27)** — the draft shows in plain words only, with Apply and Reject. The raw JSON box
  and its Save go away. To change a draft, the organiser rejects it and asks again.
- **994 (2026-11-27)** — fix the existing hole: an applied or rejected draft can be edited back to
  `ready` (and applied a second time) or flipped. The API refuses.
- **995 (2026-11-27)** — one plain-words draft view, used by the assistant page and the chat
  proposal card.
- **996 (2026-11-27)** — fix the double Apply too: two Applies of one ready draft at the same moment
  (two tabs) both pass the `ready` check (`applyDraft`, `organizer-ai-assistant.service.ts:256-314`)
  and run its actions twice. Apply claims the draft in one conditional step; a second Apply refuses.
- 963, 985 stand (each writing tool checks maintenance itself).

## Calls made (the operator may overrule)

Each: the call — why — the cost if wrong.

- **R. The draft tools need the page's bar: org admin.** `createDraftFromAction`, `applyDraft` and
  the page's nav entry all require org admin or owner (`assertOrgRole(..., 'admin')`). An editor
  could make a draft they cannot apply. The refusal says so: "Only the organisation's admins can
  make drafts at <Event>." — Cost if wrong: an editor asks an admin, as in the app today.
- **S. A draft from Claude is `source = 'mcp'`.** Migration 0287 widens the `source` CHECK
  (`form|chat` → `form|chat|mcp`). `createDraftFromAction` takes `source`, `prompt` and the audit
  payload's extra fields as options; the chat keeps `chat`. The create audit row carries `via:
'mcp'`, `clientId`, `clientName` (4a's call L, the same app-name read). `ai_usage_feature` keeps
  the chat's value for chat; for MCP it is the table default — no AI usage is spent on our side
  (call D). — Cost if wrong: one CHECK widening; a second branch taking 0287 on `main` first means
  renumbering at merge (the replay gate catches it).
- **T. A draft holds one or several actions.** `proposed_actions_json` is an array, and one draft
  type allows several actions of its one kind. `createDraftFromAction` takes `actions[]` (the chat
  passes `[action]`). `draft_match_schedule` takes a list of placements and makes one draft. The
  other three tools make one action. — Cost if wrong: none.
- **U. The names live in the API; the words live in web-admin.** A new API owner,
  `readableDraftActions(eventId, actions)`, turns each action's ids into data names with batched
  reads: Tournament name, Match round code (`roundCodeFromMatchRow`), piste (`lices.name`), the
  time with the Event's zone, the phase type. `mapDraft` answers `readable` beside the raw
  `proposedActions` on `GET /drafts`, `GET /drafts/:id`, and the chat conversation's proposals. The
  web component `DraftActionsView` words them in EN and FR (hard rule 6). An id the API cannot name
  (a Match deleted since) answers a `missing` marker, worded "a Match removed since" — never the
  id. — Cost if wrong: one extra read per draft list (batched, at most 50 drafts).
- **V. The page opens one draft by `?draft=<id>`.** Not a sub-route: the list stays beside it. The
  page fetches `GET /drafts/:draftId` (it exists, nothing calls it yet), so a draft older than the
  newest 50 still opens. An unknown or foreign id shows "This draft is not at this Event." After
  Apply or Reject the open draft reloads (today it keeps its old status). — Cost if wrong: none.
- **W. The link is the one place an id leaves the API.** The answer's `link` is
  `https://admin.${DOMAIN}/org/{orgSlug}/events/{eventId}/ai-assistant?draft={draftId}` (the page's
  route has the Event id in its path; the API builds admin links this way already,
  `admin-organizations.service.ts:909-910`). The tools' text never names an id; the no-raw-ids
  check runs on the answer with `link` removed, and the test asserts `link` itself. — Cost if wrong: Claude prints
  a URL with ids in it, which is what a link is.
- **X. Each tool checks before it saves what Apply would refuse,** so a link never leads to a draft
  that fails on Apply: maintenance; the Event gate; org admin; completed or archived Event; the
  Tournament by slug; `draft_pools` on a Tournament that already has a Pool phase refuses ("…
  already has Pools. Change them in MyClash."), because `force` is never exposed (ruling 284's
  fought-bout guard stays the app's); `draft_bracket` on a Tournament with a bracket the same. The
  phase-exists read has ONE owner, extracted from `generatePools` (`phases.service.ts:211-216`) and
  `generateBracket` (its elim guard, `.in('type', ['single_elim','double_elim'])`):
  `existingPhase(db, tournamentId, types)`, called by both and by the tools.
  `draft_match_schedule` resolves each Match by round code (4a call O) and each piste by name in the
  Event, and parses the time as the Event's wall clock (`eventZone` + `zonedToUtcIso`,
  `@myclash/time`). A piste clash is not pre-checked: Apply refuses it (`assertNoCollision`,
  `match-placement.service.ts:209-251`), as for a draft made in the app. A draft the shape check
  marks `failed` answers a refusal with its errors, not a link.
- **Y. The create tool takes a name AND a slug.** No slug owner exists to derive one (the wizard
  keeps a private `slugify`, `Step1Basics.tsx:35`; the API has three more copies), and a fifth copy
  is the wrong fix. Claude sends the slug, checked by the door's `slug` rule (`mcp-answer.ts:55`); a
  slug already in the Event refuses by name before the draft is saved (the same read as
  `events.service.ts:3137-3145`).
- **Z. Annotations.** The four tools write a draft row, so `readOnlyHint: false`,
  `destructiveHint: false` (nothing in the Event changes until Apply), `idempotentHint: false`.
  `mcp.http.test.ts`'s rule becomes: a tool that lacks `readOnlyHint` is one of the five named
  writing tools, and each refuses in maintenance without writing. `MCP_SERVER_VERSION` 1.3.0.

## Named, not changed

- Moving a Match (`placeMatches`) never re-judges its referees — at every placement door in the app
  (schedule board, programme, phases, matches, the assistant). A draft from Claude goes through the
  same door. Rule 8 at placement is a separate slice; the operator decides.
- `validationState` errors and warnings are API English; the page shows them as they are.
- Drafts never expire (no `expires_at`).

## Tasks

One task = one commit (plus its fix commits). Every test that guards a fix is falsified.

### Task 1 — An applied or rejected draft stays as it is (rulings 994, 996)

- **The claim (996).** `applyDraft` today reads the row, checks `status === 'ready'`, runs the
  actions, then writes `applied`. Two Applies both pass the read. The status CHECK
  (`0031:22-24`) has no in-between value, so: claim with one conditional update BEFORE the actions
  — `update({ status: 'applied', applied_at, applied_by_user_id }).eq('id').eq('event_id')
.eq('status', 'ready').select('id')`; zero rows → 409 `draft_closed` ("This draft is already
  applied or being applied"). A failed action keeps today's path (marks `failed`, the
  `…apply_failed` audit row, rethrows). The success audit row stays after the actions. Name the
  window in the docstring: between the claim and the end, the row reads `applied` while the
  actions run. Test: two Applies at once — the second gets 409 and runs no action; the claim's
  update arguments asserted whole (the `.eq('status','ready')` above all). Falsify by dropping the
  status filter.

- `updateDraft` (`organizer-ai-assistant.service.ts:~205-240`): new actions or a status change on
  an `applied` or `rejected` draft refuse with 409 `draft_closed` ("This draft is already applied"
  / "… rejected"). A `failed` or `ready` draft may still be rejected.
- Tests: PATCH actions on an applied draft → 409, no update call; reject an applied draft → 409;
  reject a ready draft → still works; the chat's reject (`organizer-chat.service.ts:276`, through
  `updateDraft`) of an applied proposal → 409. Falsify.

### Task 2 — `createDraftFromAction` takes a source and several actions (calls S, T)

- Migration `0287_ai_draft_source_mcp.sql`: the CHECK is unnamed inline (`0116:41-42`), so its
  name is `organizer_ai_assistant_drafts_source_check`; drop it BY that name and add the widened one
  (memory: a CHECK drop on PG17 can fail SILENTLY — after the replay, read `pg_get_constraintdef`
  for the table and assert exactly one source CHECK, holding `mcp`). Max+1: check `main` and the
  branch for 0287 before writing it.
- The create audit row's payload gains `via`, `clientId`, `clientName` for MCP: add
  `audit-payload-refs.ts` rules (action-scoped) for every id in the `event.ai_assistant_draft_created`
  payload, with a test (the file's MAINTENANCE rule; 4a Task 9 hit it).
- Signature: `createDraftFromAction(eventId, actor, actions: Record<string, unknown>[], opts)`,
  opts gain `source: 'chat' | 'mcp'`, `prompt?`, `auditExtra?`; the chat caller passes `[action]`
  and `source: 'chat'`. Insert and audit assert their whole arguments in tests.
- `pnpm db:migrations:replay` on a fresh `postgres:17` + `pnpm db:review`.

### Task 3 — The draft's names (call U)

- `apps/api/src/modules/organizer-ai-assistant/readable-draft.ts`: `readableDraftActions(db,
eventId, drafts)` — one batched read per kind of id, scoped to the Event. The type
  (`ReadableDraftAction`, a discriminated union on `kind`, no id at any depth) lives in
  `@myclash/types` (types only), so the API and web-admin share it; web-admin's hand-kept
  `ChatProposal` (`ProposalCard.tsx:3-10`) uses it. Build `./packages/*` before typechecking
  (myclash-gates).
- `mapDraft` callers answer `readable`: `listDrafts`, `getDraft`, `createDraftFromAction`. The chat
  keeps a SECOND draft mapper (`organizer-chat.service.ts:474-488`, `loadDrafts`): it gets its draft
  view from the assistant's owner instead (one owner), so its proposals carry `readable` too.
  Regenerate the API client (`pnpm openapi:client`); commit it alone if it moved.
- Tests: each kind named; a missing Match → `missing`; every select string and `.eq`/`.in`
  asserted; `expectNoRawIds`-style check on `readable` (reuse the MCP helper or its rule).

### Task 4 — The page and the chat card show the draft in words (rulings 989, 993, 995; call V)

- `apps/web-admin/src/components/DraftActionsView.tsx` (or beside the page if a shared folder fits
  better — one owner): renders `readable` with i18n keys `organizer.aiAssistant.readable.*` in EN
  and FR; times in the Event's zone (`formatInZone`, `packages/time/src/index.ts:161`).
- The page: `?draft=` opens one draft via `GET /drafts/:id`; the JSON textarea, `actionsJson` and
  `saveDraft` go (and their now-unused i18n keys: `saveSuccess`, `saveError`, `actions`, if no other
  caller); the open draft reloads after Apply/Reject.
- `chat/ProposalCard.tsx` renders `DraftActionsView` instead of `key: String(value)`.
- Tests: the page opens `?draft=`; a 404 (a foreign or unknown id — `getDraftRow` reads by id AND
  Event, `service.ts:621-628`, and its message carries the id) shows the page's own words, never the
  API message; no UUID in the rendered page (a regex over the text); the card the same; EN+FR keys resolve; a new a11y spec `tests/a11y/ai-assistant-draft.spec.ts` (stubbed
  API, as the other a11y specs) — axe clean, the draft in words.

### Task 5 — The draft gate and `draft_tournament`, `draft_pools` (calls R, W, X, Y, Z)

- `mcp/tools/draft-gate.ts`: maintenance, Event gate, org admin, completed/archived, the app name,
  the link, the answer shape `{ draft: <the readable actions>, link, status }` — Claude words the
  names itself (spec call F), so no second wording of a draft exists; the `failed` → refusal rule.
  The row's `prompt` (NOT NULL) is `Claude proposed: <kind>` (as the chat's `Chatbot proposed:
<kind>`, `service.ts:162`); `summary` stays null. Reuse 4a's
  owners (`maintenanceRefusal`, `readableEventBySlug`, `readableTournamentId`, the app-name read).
- `McpToolDeps` gains the assistant service; `McpModule` imports its module (boot once: no cycle).
- The two tools + registration; `mcp.http.test.ts` rule change; version 1.3.0 lands with Task 6.
- Accept: per tool, one test per refusal (maintenance refuses before any read; no Event; no
  Tournament; not an org admin; completed / archived; existing phase or taken slug; a `failed`
  draft); the happy path saves ONE draft whose `createDraftFromAction` arguments are asserted whole
  (actions, `source: 'mcp'`, the audit extra); every answer passes `expectNoRawIds` once `link` is
  removed, and `link` equals the expected admin URL; every new select string and `.eq`/`.in`
  asserted; the http test red when a draft tool's maintenance check is removed (falsified).

### Task 6 — `draft_bracket`, `draft_match_schedule`

- As Task 5. The schedule tool: a list of `{ match, piste, start }`, max 50; each Match by round
  code, each piste by name, each start the Event's wall clock → UTC; one draft of N actions.
- `MCP_SERVER_VERSION` 1.3.0; the tool-list pin.
- Accept: as Task 5, plus for the schedule tool: an unknown Match code, an unknown piste, an
  unreadable time and more than 50 placements each refuse by name; a wall-clock time in a New York
  Event is stored as the right UTC instant (memory: zone tests use New York); one draft holds N
  actions.

### Task 7 — Docs, and the slice closes

- ARCHITECTURE §28.5d (the four tools, calls R-Z), §28 intro tool count; the assistant section of
  ARCHITECTURE (find it) for the page's one-draft link and the plain view; ADR-016 unchanged unless
  the assign door changed. The spec moves to `docs/superpowers/archive/specs/` (4a and 4b shipped);
  this plan is deleted in the closing commit (CLAUDE.md).

## Verification

- Gates: the `myclash-gates` chain (31), the DB replay set (Task 2 touches `packages/db`), and the
  Playwright browser suite locally (`pnpm test:e2e`), because CI runs only at the end (ruling 992).
- Whole-branch review over 4b, one fix wave, scoped re-review.
