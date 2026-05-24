# Referee skills catalog + dynamic Staffing (slot config) — design

## Why

Organizer-reported friction:

1. The **Qualifications** tab on `/org/[slug]/events/[eventId]/referees` is a person×skill rating matrix. It's where ratings live but it's not a catalog — there's no single view that says "what skills exist at this event, and how many people hold each."
2. The **Assignment** tab and **Pool management** views hard-code three referee columns (`Lead referee / Assessor referee / Table referee`, i.e. `arbitre_declarant / arbitre_assesseur / arbitre_table`). Organizers who staff finals with 5 refs or who use custom roles have no UI surface for that today; the code silently drops anything that doesn't map onto the three built-in roles.
3. The default system skills (`Déclarant`, `Assesseur`, `Table`) need a dedicated edit/delete UX so customisation is possible while system skills stay locked.

This change introduces a **per-tournament staffing config** (with event-level default fallback) that drives the assignment + pool-management UIs dynamically, and rebuilds the Qualifications tab as a skill catalog.

## Decisions (from clarifying questions)

- **Distribution config scope**: per-tournament, with an event-level default fallback. Hard-coded `[Décl, Asses, Table]` is the floor when neither row exists.
- **Finals definition**: the top-3 medal matches (semifinals, final, third-place). Detected at query time from bracket round metadata, not stored on `matches`.
- **Slot allowed-skills rule**: array of skill_ids. Default seeds a single-element array per slot (matches the legacy 1-Décl / 1-Asses / 1-Table behaviour).
- **Rating-matrix relocation**: matrix stays accessible from the **Referees** tab (rows = referees, cols = skills) **and** a per-skill drill-down opens from each row of the new Qualifications catalog.
- **Assignment tab layout**: one table per tournament. Columns come from that tournament's slot config for the relevant phase-type.
- **Tab name**: **Staffing** (chosen over "Distribution" which is overloaded with pool-seeding language in the codebase).
- **Conflict UX**: saves that would invalidate existing assignments (reduced slot count, narrowed allowed skills) block with a confirm dialog listing the affected assignments.

## Schema

Two new tables per scope (tournament + event-default), mirrored, normalized so slot edits are well-defined SQL operations rather than jsonb patches.

```sql
-- Per-tournament slot configuration.
CREATE TABLE tournament_slot_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  phase_type      TEXT NOT NULL CHECK (phase_type IN ('pool','bracket','finals')),
  slot_index      INT  NOT NULL CHECK (slot_index BETWEEN 1 AND 6),
  display_name    TEXT,                       -- optional friendly label e.g. "Lead"
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, phase_type, slot_index)
);
CREATE INDEX tournament_slot_config_tournament_phase_idx
  ON tournament_slot_config (tournament_id, phase_type);

-- Skills allowed in each slot (many-to-many slot ↔ skill).
CREATE TABLE tournament_slot_allowed_skills (
  slot_config_id  UUID NOT NULL REFERENCES tournament_slot_config(id) ON DELETE CASCADE,
  skill_id        TEXT NOT NULL REFERENCES referee_skills(id) ON DELETE RESTRICT,
  PRIMARY KEY (slot_config_id, skill_id)
);

-- Event-level default (same shape).
CREATE TABLE event_slot_config_default (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  phase_type      TEXT NOT NULL CHECK (phase_type IN ('pool','bracket','finals')),
  slot_index      INT  NOT NULL CHECK (slot_index BETWEEN 1 AND 6),
  display_name    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, phase_type, slot_index)
);
CREATE INDEX event_slot_config_default_event_phase_idx
  ON event_slot_config_default (event_id, phase_type);

CREATE TABLE event_slot_config_default_skills (
  slot_config_id  UUID NOT NULL REFERENCES event_slot_config_default(id) ON DELETE CASCADE,
  skill_id        TEXT NOT NULL REFERENCES referee_skills(id) ON DELETE RESTRICT,
  PRIMARY KEY (slot_config_id, skill_id)
);
```

### Resolver

Given `(tournamentId, phaseType)`:

1. Query `tournament_slot_config` for that pair. If any rows exist → return them (sorted by `slot_index`).
2. Else: look up the tournament's `event_id`, query `event_slot_config_default`. If any rows exist → return them.
3. Else: return the hard-coded floor — 3 slots, each with one of `arbitre_declarant / arbitre_assesseur / arbitre_table` as the lone allowed skill.

No proactive seeding. Empty config = hard-coded default. Rows are written only when an organizer touches the Staffing tab.

### Backwards compatibility

`referee_assignments.role` already stores a `skill_id` string. The new slot config doesn't change that column's shape — assignment writes still record `role = <skill_id>` exactly as today. Existing `arbitre_declarant / arbitre_assesseur / arbitre_table` rows continue to resolve cleanly against the default config.

### Finals detection

A match is "finals" when both:

- its phase is `single_elim` or `double_elim`, **and**
- it is one of: **the final** (last round of the bracket), **the semifinal(s)** (the round before the final, i.e. round-of-4 matches), or **the third-place match** (the auxiliary match that runs alongside the final).

The implementer should check `apps/api/src/modules/bracket/` and `bracket_slots.round` / `bracket_slots.position` semantics in this codebase to confirm the exact predicate — round numbering convention (ascending vs descending) varies. The third-place match is conventionally stored as a sibling of the final at a known position pair; the bracket service already exposes a helper that identifies it (search for `thirdPlace` / `is_third_place`).

The resolver receives a `(tournament_id, phase_type)` pair, so the caller is responsible for classifying a match as `pool | bracket | finals` before requesting the config. Helper `classifyMatchPhase(matchId)` lives in `apps/api/src/modules/referees/staffing.service.ts` and returns one of `'pool' | 'bracket' | 'finals'`.

## Backend API

All endpoints under `/api/v1`. Org-admin gating via `OrganizationsService.assertOrgRole(orgId, userId, 'admin')` for writes; org-member (`'scorekeeper'`) for reads.

```http
GET    /events/:eventId/slot-config
PUT    /events/:eventId/slot-config             { pool, bracket, finals }
GET    /tournaments/:tournamentId/slot-config
PUT    /tournaments/:tournamentId/slot-config   { pool, bracket, finals }
POST   /tournaments/:tournamentId/slot-config/reset       (drops tournament rows; future reads fall back to event default)
```

Shared payload shape:

```ts
type Slot = {
  index: number; // 1..6, dense
  displayName: string | null;
  allowedSkillIds: string[]; // ≥ 1; references referee_skills.id
};

type SlotConfigPayload = {
  pool: Slot[]; // 1..6 slots
  bracket: Slot[]; // 1..6 slots
  finals: Slot[]; // 1..6 slots
  inheritsEventDefault?: boolean; // only on tournament GET, indicates which branch resolved
};
```

### PUT semantics

- Whole-config replace: the request defines the full state for all three phase-types. The service diff-applies (insert / update / delete) within a single transaction.
- **Pre-commit dry-run**: the service computes `affectedAssignments[]` — every existing `referee_assignments` row that would become invalid (slot_index ≥ new slot count, or skill_id ∉ new allowed skills). If the request omits `confirmDestructive: true`, the API returns **409 Conflict** with the affected list. The client confirms; the second PUT carries `confirmDestructive: true` and the service cascades the unassignment then writes the new config.

### New module

```text
apps/api/src/modules/referees/staffing.service.ts
apps/api/src/modules/referees/staffing.controller.ts
apps/api/src/modules/referees/dto/staffing.dto.ts
apps/api/src/modules/referees/staffing.service.test.ts
```

The existing `referees.module.ts` adds the new controller/service to its providers.

## Frontend

### Qualifications tab — Skill catalog

Page: `apps/web-admin/app/org/[slug]/events/[eventId]/referees/page.tsx`, `activeTab === 'qualifications'`.

- Replaces the matrix with a table whose **rows = skills** (system + custom).
- Columns:
  - color swatch (rendered with `tintBgClassFor(skill.color)`)
  - skill name (link-style; clicking opens the drill-down drawer)
  - **count of qualified referees** in this event (computed from `referee_qualifications` where `active = true`)
  - `✎ Edit` button (modal — name + color, system skills disabled)
  - `🗑 Delete` button (system skills hidden; custom skills hit the existing 409-on-active-quals path)
  - A `system` pill on system rows
- **Drill-down drawer**: clicking a skill row opens a side drawer listing every event referee with their current rating (1–5) as a select; identical handlers to the existing `upsertQualification` / `removeQualification`. Lets the organizer fan-out edits skill-first.
- Skill edit modal — what fields? The `referee_skills` table has `id, event_id, name, color, is_system, sort_order`. The editable surface is **name + color** only. `sort_order` is not exposed in v1 (rows display by sort_order then created_at, identical to today).

### Referees tab — gains the matrix

The current rating-editor matrix (rows = referees, columns = skills) moves to this tab. Rendering is the same component the Qualifications tab used to host; the parent just changes. The Referees tab keeps its existing availability flags + assignment summary columns.

### Staffing tab (new)

Path: same page, new `activeTab === 'staffing'`.

- **Top toolbar**: tournament picker (one tournament at a time, default = first published) + an "Inherits from event default" / "Override per tournament" toggle.
- **Three sections** in card layout: **Pool**, **Bracket**, **Finals**.
- Per section:
  - Stepper labelled "Slot count" with `1..6` clamp.
  - N slot rows (synchronised to the stepper). Each row:
    - optional `Display name` input (placeholder "Slot 1" / "Slot 2" / etc.)
    - multi-select chip list of allowed skills (defaults to a single chip on creation; chips render with `tintBgClassFor(skill.color)`; `−` to remove, `+ Add skill` to add). At least one chip is required.
  - "Reset to event default" button (per phase-type).
- **Save** at the bottom of the page (one PUT for the whole config). If a 409 Conflict comes back, render a confirm dialog with the affected assignment list and re-PUT with `confirmDestructive: true`.

### Assignment tab — per-tournament tables

Same page, `activeTab === 'assignments'`.

- Replaces the current single board with **per-tournament tables**. A tournament picker at the top (defaulting to "All tournaments" which renders one sub-table per tournament, vertically stacked).
- For each tournament, the table columns come from `slot-config` resolved for that tournament. Within a phase-type the column set is uniform (per the per-tournament decision); across phase-types the table is split into sub-sections (Pool table, Bracket table, Finals table).
- Each cell still uses the existing `POST /referee-assignments` / `DELETE /referee-assignments/:id` endpoints — the `role` value written is the slot's selected `skill_id` (single-skill slot) or the dropdown-chosen `skill_id` (multi-skill slot).
- Removing the `REFEREE_ASSIGNMENT_ROLES` const + any helper that assumed exactly three roles. The new column derivation lives in the assignment-board service alongside the slot resolver.

### Pool management — same dynamic columns

The pool detail surface lives under `apps/web-admin/app/org/[slug]/events/[eventId]/pools/` (entry: `page.tsx`, with tabs in `_tabs/`). The implementer should locate every place that today renders fixed "Lead / Assessor / Table" referee slots or columns (search anchors: `arbitre_declarant`, `REFEREE_ASSIGNMENT_ROLES`, the `roleSlots` field on `AssignmentBoardPool`) and replace them with a slot iterator driven by `slot-config` for `(pool.tournament_id, 'pool')`.

The slot count and the per-slot allowed-skills list both come from the resolver — the pool detail does not reach into the referee assignment board for this; it calls the staffing service directly so pool-level changes don't depend on the assignment board re-rendering. No new screen, no schema change inside pools.

## Edge cases

1. **Slot count reduced below existing assignments** (e.g. 5 → 3, slots 4-5 have refs). → 409 with affected list. Confirm dialog lists them. On confirm, the service deletes the orphan `referee_assignments` rows in the same transaction as the config write.
2. **Allowed skills narrowed** so a current assignee's role isn't allowed any more. → Same 409 / confirm flow.
3. **Catalog deletes a skill referenced by a slot.** → Already blocked by `ON DELETE RESTRICT` on `tournament_slot_allowed_skills.skill_id` and the corresponding event-default join. The existing 409-on-delete path in the skills controller is extended to enumerate slot references in addition to active qualifications.
4. **Tournament inherits from event default; event default later changes.** → Tournament reads re-resolve at read time. No invalidation flow needed.
5. **`referee_assignments` rows with `role = null`** (older data — pre-roles). → Treated as unassigned; not surfaced in the dynamic columns. No migration needed.

## i18n

EN + FR (Caveman-style French — short, accent-light per the codebase convention).

- `organizer.refereesPage.tabs.staffing` → "Staffing" / "Effectif"
- `organizer.refereesPage.qualifications.skillName` → "Skill" / "Competence"
- `organizer.refereesPage.qualifications.qualifiedCount` → "Qualified referees" / "Arbitres qualifies"
- `organizer.refereesPage.qualifications.systemPill` → "System" / "Systeme"
- `organizer.staffing.*` (new namespace) — `pool / bracket / finals` section headers, slot stepper label, "Allowed skills" chip-list label, "Reset to event default", "Inherits from event default", confirm dialog body, etc.
- `organizer.staffing.conflict.title` → "Save will remove existing assignments"
- `organizer.staffing.conflict.body` → "{count} referee assignment(s) become invalid under the new config:"

## TDD plan

Backend, red-then-green per skill:

1. `staffing.service.test.ts` — `getResolvedConfig(tournamentId)` returns hard-coded default when no rows exist.
2. Same — returns event default when only event rows exist.
3. Same — returns tournament rows when both exist.
4. `putTournamentConfig(tournamentId, payload, { confirmDestructive: false })` throws `ConflictException` listing affected assignments when slot count shrinks below existing.
5. Same call with `confirmDestructive: true` cascades unassignment + writes new rows in one transaction.
6. `putTournamentConfig` rejects a slot with empty `allowedSkillIds`.
7. `putTournamentConfig` rejects > 6 slots per phase-type.
8. `resetTournamentConfig(tournamentId)` deletes tournament rows; subsequent `getResolvedConfig` returns event default.

## Files

### New

- `packages/db/migrations/0060_staffing_slot_config.sql`
- `apps/api/src/modules/referees/staffing.controller.ts`
- `apps/api/src/modules/referees/staffing.service.ts`
- `apps/api/src/modules/referees/staffing.service.test.ts`
- `apps/api/src/modules/referees/dto/staffing.dto.ts`
- (Optional) `packages/types/src/staffing.ts` for shared `Slot` / `SlotConfigPayload` types.

### Modified

- `apps/api/src/modules/referees/referees.module.ts` — register new providers.
- `apps/api/src/modules/referees/referees.service.ts` (or wherever skill-delete lives) — extend the 409-on-delete check to include slot references.
- `apps/api/src/modules/referees/assignment-board.service.ts` — column derivation uses `getResolvedConfig` instead of the hard-coded role list.
- `apps/web-admin/app/org/[slug]/events/[eventId]/referees/page.tsx` — three tab rewrites: Qualifications (catalog), Referees (matrix), Staffing (new); Assignment tab consumes dynamic columns.
- Pool detail components that reference referee slots — switch to dynamic column count.
- `packages/i18n/src/index.ts` — new namespace + key edits.

## Out of scope

- Drag-reorder of slots (slot_index is editable; reorder via the stepper is acceptable for v1).
- Per-match staffing override (a final match needing 6 refs when the tournament default is 4). Could be a future surface but not asked.
- Multi-skill slot picker UX beyond a chip list (no autocomplete, no priority ordering — first chip is the displayed one in narrow columns).
- Bulk drag-assign in the Staffing tab.

## Verification

- Apply migration 0060; `\d tournament_slot_config` shows the four new tables.
- API tests 8 new green.
- Qualifications tab renders skills (incl. system) + counts; click → drawer; edit + delete buttons gated correctly.
- Referees tab matrix unchanged in behaviour from the old Qualifications tab.
- Staffing tab persists per-tournament config; "Reset to event default" wipes tournament rows.
- Assignment tab columns mirror the saved slot config (verify by adding a 4th slot — column appears).
- Pool detail slot count matches `pool` slots count.
- Reducing slot count with active assignments → 409 → confirm → cascade unassign + save.
