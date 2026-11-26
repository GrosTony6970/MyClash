# MCP slice 4a — referee swap from Claude (plan)

Spec: `docs/superpowers/specs/2026-11-24-mcp-server-design.md`, "Slice 4 — organiser writes".
Branch `feat/mcp-writes`, worktree `.claude/worktrees/mcp-writes` (ruling 956's model).

## What the organiser gets

Marie runs the Longsword Open. During the Event she types in Claude: "put Paul on LSW-P2-M04 as
Déclarant instead of Jean". Claude calls `preview_referee_assignment`. MyClash answers in plain
words: the bout, its start and piste, who holds the role now (Jean), who would hold it (Paul), and
every soft-rule warning ("Paul fights in Pool 3 at that time"). Nothing has changed yet. Marie
says "yes". Claude calls `apply_referee_assignment` with the confirmation the preview gave.
MyClash checks again and writes the change. The audit log records that it came from Claude.

A hard rule (rule 8) always refuses, at preview and at apply, with no override.

## Rulings

- **989 (2026-11-26) — Slice 4 is split.** Story: the organiser asks Claude for 4 Pools; Claude
  saves a draft; the link opens the assistant page's list, and the draft shows as a box of raw
  JSON full of ids (`ai-assistant/page.tsx:364-377`). Ruling: slice 4a builds the referee swap
  only. Slice 4b, a separate slice, first makes the assistant page open one draft from a link and
  show it in plain words (names, never ids), then adds Claude's four draft tools (create a
  Tournament, generate Pools, generate a bracket, schedule Matches).
- **990 (2026-11-26) — 4a also removes a referee, and the audit row names the app.** The
  operator approved the plan and asked for both items it had left out: "take Jean off
  LSW-P2-M04" previews "Déclarant: Jean → nobody" and applies on yes; the audit row carries the
  connected app's name, read from the sign-in server.
- 963 (soft-rule override in chat), 985 (the door passes read-only mode; each write tool calls
  `assertNotReadOnly`) stand.

## Calls made (the operator may overrule)

Each: the call — why — the cost if wrong.

- **G. The confirmation is a sealed token, not a stored row.** AES-256-GCM over
  `{v, sub, cid, matchId, role, personId, prev, codes, exp}`, key = HKDF-SHA256 of
  `SUPABASE_JWT_SECRET` with info `myclash/mcp/confirm/v1`. Sealed, not only signed: the ids
  inside stay hidden from the model (no raw id at any depth). No table, no migration, no new
  `.env` key. — A stored row needs a migration, RLS and the archive guard for a 10-minute life. —
  Cost if wrong: a token can be replayed inside its 10 minutes; see "replay" below, it cannot
  write twice.
- **H. The apply is single-use by state, not by a ledger.** The token carries `prev`, the person
  who held the role on that bout at preview time (or none). Apply refuses unless the holder is
  still `prev`. After an apply the holder is the new person, so a replay is refused. — Cost if
  wrong: none found; a swap back (A→B, then B→A) needs a new preview, which is right.
- **I. Apply refuses a warning the person did not see.** Apply judges again. A Discouraged reason
  whose code was not in the preview refuses with "something changed, preview again". An
  Impossible one refuses as always. — Cost if wrong: an extra preview in a busy minute.
- **J. Who may swap: the app's own bar.** Editor or above in the Event's organisation
  (`assertCanManageEvent`, `MANAGE_EVENT_ROLE = 'editor'`), the bar of
  `PUT matches/:id/referee-role-assignments` (`staff.service.ts:1052-1058`). Not the route's
  helper itself: it needs the request and calls GoTrue `/user`, which the MCP path must avoid
  (spec, Constraints).
- **K. A completed or archived Event refuses**, as the route does today through
  `getMatchContext(..., 'refuse')` (`staff.service.ts:1627-1629`). The tool reads the Event's
  status itself: `EventReadOnlyGuard` finds no Event in `/api/v1/mcp` and passes it.
- **L. The audit row names the app (ruling 990).** `audit_log` has no source column; the payload
  carries `via: 'mcp'`, `clientId` and `clientName`. The name comes from GoTrue's admin read
  `GET /admin/oauth/clients/{id}`, through supabase-js `auth.admin.oauth.getClient`
  (`@supabase/auth-js` 2.119, `GoTrueAdminApi.js:42,874-876`). Read once at apply, before the
  write. A failed read logs a warning with the status and writes `clientName: null`; the write
  still goes ahead (the person is the actor either way). UNVERIFIED on our GoTrue 2.198: the
  builder proves the call and its answer shape on the local stack before Task 5.
- **M. Removal (ruling 990) only takes off a holder of THIS Match.** `replace_match_referee_role`
  with a null person deletes the Match's own rows for the role and inserts none
  (`0207:18-41`). A holder who comes from the Pool's or the Lice's crew stays, so removing them
  from one Match cannot be written. The preview refuses that case by name: "Jean holds Déclarant
  for all of Pool 2, not this Match alone. Change it on the Pools page, or name someone for this
  Match." No holder refuses: "Nobody holds Déclarant on this Match." A removal skips the checker
  (`matches.service.ts:438-443`): taking someone off a slot breaks no referee rule.
- **M2. The preview shows the Match's whole crew before and after.** The crew screens resolve one
  tier for all roles together (match > pool > lice, `resolve-match-referees.ts:95-108`), so the
  first Match-level row hides the Pool crew's other roles on that Match. The preview computes
  both crews with the same resolver, so the person sees that side effect before saying yes.
- **N. Words for the reasons: one owner.** `refereeReasonText` / `refereeReasonsText` move out of
  web-admin (`src/lib/referee-reasons.ts:28-75`) to `packages/rulesets/src/scheduling/` beside
  the checker that owns the codes (types only, a `Translate` parameter, no i18n import). Web-admin
  and the API call the same switch. The API words them in English (`createTranslator(messages.en)`,
  as `tournament-standings.ts` does): Claude reads English and answers the person in theirs
  (spec call F).
- **O. The bout is named by Tournament slug + round code** (`LSW-P2-M04`, what the app shows,
  `roundCodeFromMatchRow`). No column is unique: the tool derives the codes of the Tournament's
  bouts and refuses when a code matches none or several.
- **P. The role is named by the skill's name or id** (`Déclarant` or `arbitre_declarant`,
  case- and accent-blind), among the Event's skills (`referee_skills` with `event_id` null or this
  Event).
- **Q. The referee is named by full name** from the Event's referee roster
  (`QualificationsService.listEventReferees`), grouped by person: an exact full name wins
  (case- and accent-blind), else a "contains" match; several → a refusal listing their names (with
  club) so Claude asks which; none → a refusal. A person who lacks the role's skill refuses by name.

## The race, named

- **Preview vs apply:** someone changes the bout's referee in the app between the two. Handled by
  call H (holder must still be `prev`) and call I (new warnings refuse).
- **Apply's judge vs the write's own judge:** apply judges, then `setRefereeRoleAssignment`
  judges again inside and writes. A Discouraged reason born in those milliseconds passes under
  `confirm: true`. Accepted: an Impossible one still refuses inside the write.
- **Two applies of one token at once:** both pass the `prev` check, both write the same
  assignment (the RPC replaces atomically, `0207`). Same end state; two audit rows. Accepted.

## Pre-flight (verified 2026-11-26 in code, recon reports in this session)

- `MatchesService.setRefereeRoleAssignment(matchId, role, refereeId, confirm)` —
  `matches.service.ts:411-455`; checks the board lock, calls `refereeBoard.judgeWrite`, writes via
  RPC `replace_match_referee_role`. Writes no audit row.
- `AssignmentBoardService.judgeWrite(eventId, write)` — `assignment-board.service.ts:585-622`;
  throws the 409s through `refuseUnlessFine` (`write-verdict.ts`). No non-throwing form exists.
- `assertRefereeBoardUnlocked(db, eventId)` — `referees/referee-lock.ts:42-47`, 409
  `referee_board_locked`.
- `assertCanManageEvent(deps, eventId, userId)` — `common/auth/event-authz.ts:166-175`.
- `assertNotReadOnly(supabase)` — `common/read-only-mode.ts:32`, 503.
- `insertAuditLog(supabase, entry)` — `common/audit-log.ts:150-165`, returns `{ error }`.
- `QualificationsService.listEventReferees(eventId, actorUserId)` — `qualifications.service.ts:682`,
  `read_only` bar (an editor passes), returns `personId`, `displayName`, `clubLabel`,
  `qualifications[{skillId}]`.
- `resolveMatchReferees` — `matches/resolve-match-referees.ts:91`, scope precedence match > pool >
  lice.
- `ROUND_CODE_INPUTS`, `roundCodeFromMatchRow` — `matches/round-code.helper.ts:85-143`.
- `readableTournamentId` — private in `mcp/tools/tournament-query.ts:83-106`.
- Modules: `MatchesModule` exports `MatchesService`; `RefereesModule` exports
  `QualificationsService`, `AssignmentBoardService`. Neither is imported by `McpModule` yet.
- `mcp.http.test.ts:229-237` fails when a listed tool is not `readOnlyHint` (by design).

Builder verifies before Task 1: no module cycle when `McpModule` imports `MatchesModule` and
`RefereesModule` (boot the API once, `reference_module_cycle_forwardref_wrong_edge`); that the i18n
sweep reads `packages/rulesets/src` (else Task 1 extends its scope).

## Tasks

One task = one commit (plus its fix commits). Every test that guards a fix is falsified.

### Task 1 — The reason words have one owner

- Move `RefereeReasonTextCode`, `refereeReasonText`, `RefereeReasonLike`, `refereeReasonsText` to
  `packages/rulesets/src/scheduling/referee-reason-text.ts`, with its own subpath export in
  `packages/rulesets/package.json` (`./scheduling/referee-reason-text`, as
  `./scheduling/referee-checker` is, lines 17-19). No import of `@myclash/i18n` there: the
  `Translate` type is a parameter, and the module imports only TYPES from the checker, so
  web-admin ships the switch and nothing of the checker (as `referee-reasons.ts:13` promises
  today). Web-admin's callers import the moved functions from their new home (no re-export
  shim); `referee-reasons.ts` keeps its other exports.
- The key sweep (`packages/i18n/src/t-key-references.test.ts:71-96`) does not read
  `packages/rulesets`; without a root the reverse check calls the 12 `refereeBoard.reasons.*`
  keys orphans. Add the root `packages/rulesets/src/scheduling` with a comment in the style of
  its neighbours (a translator-parameter module, like `api-client`). Falsify: drop the root, watch
  the reverse check go red.
- The EN + FR test (`apps/web-admin/src/lib/referee-reasons.test.ts`) stays in web-admin and calls
  the moved functions: `packages/rulesets` takes no `@myclash/i18n` dependency.
- Rebuild `@myclash/rulesets` `dist` before typechecking the API or web-admin (myclash-gates).
- Accept: web-admin tests green, the key sweep green both ways, `packages/rulesets` builds; the
  switch still fails to compile on a new code (keep the exhaustive return).

### Task 2 — Judge without throwing

- `AssignmentBoardService.judgeVerdict(eventId, write)` returns
  `{ verdict, matchIds, skippedMatchIds }` and throws only what `judgeWrite` throws before the
  verdict (roster/skill 400, a bout not on the board). `judgeWrite` becomes `judgeVerdict` +
  `refuseUnlessFine`. One owner of the judging.
- Accept: existing `judgeWrite` tests unchanged and green; a new test: a Discouraged write returns
  its reasons from `judgeVerdict` with no throw, and `judgeWrite` still 409s on it.

### Task 2b — The crew's winning rows have one owner

- `resolveMatchReferees` (`matches/resolve-match-referees.ts:91-110`) returns names only
  (`ResolvedReferee` has no person id), and call H needs the holder's person. Extract the scope
  precedence (match > pool > lice) into an exported generic
  `winningAssignmentRows<R extends { scopeType; matchId; poolId; liceId }>(rows, target): R[]`;
  `resolveMatchReferees` calls it, then `uniqueReferees`. The MCP tools call it with rows that
  carry `person_id`. No second copy of the precedence.
- Accept: `resolve-match-referees` tests unchanged and green; a new test per tier (match wins,
  pool when no match row, lice last, none).

### Task 3 — The sealed confirmation

- The secret: `McpController` reads `SUPABASE_JWT_SECRET` through `ConfigService`, as
  `SupabaseService.verifyAccessTokenLocal` does (`supabase.service.ts:146`), derives the key once
  and passes `confirmKey: Buffer | null` in `McpToolDeps`. The tools never read the environment.
  No secret → both tools fail (the generic failure), never an unsealed token.
- `mcp/tools/write-confirmation.ts`: `sealConfirmation(secret, payload, now)` /
  `openConfirmation(secret, token, caller, now)` (call G). TTL 10 minutes. `open` answers the
  payload or `null` for: bad shape, bad tag, other key, expired, `sub` ≠ caller's user,
  `cid` ≠ caller's client. Never throws on input.
- Accept: a test per refusal; a round trip; the token string contains no UUID
  (`expectNoRawIds`); a one-byte change refuses.

### Task 4 — `preview_referee_assignment`

- Inputs: `event` (slug), `tournament` (slug), `match` (its round code, `LSW-P2-M04`), `role`
  (skill name or id), `referee` (full name, or `null` to remove the holder — call M).
  `readOnlyHint: true` — it writes nothing.
- Files: `tools/referee-write-gate.ts` holds steps 2-5 and the holder read, shared by preview and
  apply (one owner, and each file stays under the complexity caps: 400 lines, 50 per function);
  `tools/preview-referee-assignment.ts`; `tools/apply-referee-assignment.ts`.
- Steps, each refusal one sentence (via `answer()`):
  1. `readableTournamentId` (moved to `readable-event.ts`, its one owner; `tournament-query.ts`
     imports it) — the Event gate then the Tournament gate.
  2. `assertNotReadOnly` → the maintenance refusal.
  3. `assertCanManageEvent` → a `ForbiddenException` refuses: "Only the Event's organisers
     (editor or above) can change its referees."
  4. The Event's status (`events_status_check`, `0001_init.sql:176`): `completed` or `archived`
     refuses.
  5. The board lock refuses: "Referee assignments are locked at this Event. Unlock them in
     MyClash first."
  6. The Match: one select of the Tournament's matches with `ROUND_CODE_INPUTS`, codes derived,
     compared case-blind. None / several refuse.
  7. The role (call P), the referee (call Q), and the Match's crew: the active
     `referee_assignments` rows (every role) of the Match, its Pool and its Lice, with
     `person_id`, through `winningAssignmentRows` (Task 2b). Its own select, which THROWS on a read
     error: `fetchRefereeAssignmentIndex` answers `[]` on error
     (`referee-assignment-index.ts:144`), which would read as "nobody holds it" and corrupt the
     holder check. The holder of the role = the winning tier's row for that role, or none. The
     same person as the holder refuses. A removal refuses per call M.
  8. A swap: `judgeVerdict`: Impossible refuses with every reason in words; Discouraged and Fine
     answer. A removal: no judging, level `fine`.
- Answer: the Match (code, Tournament name, start UTC ISO, the Event's `timezone`, piste name,
  fighters' names), `role` (skill name), `from` (name or null), `to` (name or null),
  `crewBefore` / `crewAfter` (role name and person name, call M2), `level`
  (`fine` | `discouraged`), `warnings` (sentences), `confirmation` (token), `expiresAt`, and the
  instruction "Show the person this change, the crew after it and every warning; call
  apply_referee_assignment only after they say yes."
- Accept: one test per refusal (removal's two included); a Fine, a Discouraged and a removal
  answer; a swap over a Pool-crew holder shows the crew after it; `expectNoRawIds` on every
  answer; every new select string and `.eq` / `.in` asserted.

### Task 5 — `apply_referee_assignment`

- Input: `confirmation`. Annotations: `readOnlyHint: false`, `destructiveHint: true`,
  `idempotentHint: false`, `openWorldHint: false`.
- Steps: `assertNotReadOnly` first; `openConfirmation` (null → "This confirmation is not valid any
  more. Preview the change again."); the bout's Event; `assertCanManageEvent`; status; board lock;
  holder still `prev` (call H); `judgeVerdict` again — Impossible refuses, a Discouraged code not
  in `codes` refuses (call I) — a removal skips the judging; for a removal the holder must still
  be a Match-level row (call M); the app's name (call L);
  `setRefereeRoleAssignment(matchId, role, personId | null, codes.length > 0)`;
  `insertAuditLog` with action `match.referee_role_assigned` (or `match.referee_role_removed`),
  entity `match`, actor the caller, payload
  `{ via: 'mcp', clientId, clientName, role, previousPersonId, personId, confirmedReasons }`; an
  audit error is logged (as the module's other callers do), never answered as a failure of the
  write.
- Answer: "Done" with the Match's code, role name, `from`, `to`.
- Accept: a test per refusal; the happy path writes once with the right `confirm`; a replay of the
  same token refuses (the holder read answers the new person on the second call); a token from
  another person or client refuses; read-only refuses before any read of the Match; the audit
  insert's arguments asserted whole.

### Task 6 — The door

- Register both tools in `mcp-server.ts`; `McpToolDeps` gains `matches`, `refereeBoard`,
  `qualifications`; `McpModule` imports `MatchesModule`, `RefereesModule`. `MCP_SERVER_VERSION`
  1.2.0.
- `mcp.http.test.ts`: the "every tool read-only" test becomes "the only tool that is not
  read-only is `apply_referee_assignment`, and in read-only mode it answers the maintenance
  refusal without calling `setRefereeRoleAssignment`". Tool list pin updated.
- Rebuild the API, `pnpm openapi:client`, commit the generated file alone if it moved.
- Accept: the http test red when `assertNotReadOnly` is removed from apply (falsified).

### Task 7 — Docs and the spec

- ARCHITECTURE §28.5 read-only bullet (a write tool now exists), new §28.5c (the two tools, calls
  G-Q, the races). ADR-016's list of assign doors (line 116, and `write-verdict.ts`'s header)
  names the MCP door. ADR-016 says "No audit row is written" for the reasons confirmed over
  (line 121): keep that true and add that the MCP door writes one audit row per write, as the spec
  asks (line 210), carrying the reasons in its payload. The spec: slice 4 split (ruling 989), 4b's two parts named; the spec stays in `specs/`
  until 4b ships. `ENGINEERING_LESSONS` only if a trap appears.

## Verification

- Gates: the `myclash-gates` chain, 31 gates. Web-admin's referee-board a11y specs (Task 1 touches
  its words).
- Whole-branch review (`code-architecture-reviewer`), one fix wave, scoped re-review.
- After merge and a production redeploy with real certificates: one manual preview → yes → apply
  from claude.ai on a test Event.
