# Schedule Planner Design — 2026-05-07

## Problem

HEMA tournament organisers need to plan the full day programme of a multi-day event: defining time blocks (registration, pool sessions, bracket rounds, workshops, breaks), auto-suggesting a schedule based on match counts and lice capacity, and generating per-match start times in one shot.

The existing Schedule tab (T-706) provides a 5-minute drag-drop match grid but has no higher-level block planning layer. Organisers currently have no way to see whether all matches fit in available time, or to produce a printable day programme.

## Approach: Block planner + constrained auto-scheduler

Two layers:

1. **Programme sub-tab** — organiser builds a day plan as ordered blocks (Registration, Pool Session, Break, Workshop…). Blocks are saved to `event_programme_blocks`. The planner can auto-suggest a full plan from event parameters, and warns when a block's time window is too short for its match count.

2. **Grid sub-tab** — the existing 5-minute match grid. After pressing "Generate schedule", matches are assigned `scheduledAt` + `liceId` within their block's time window (ordered by Berger sequence). Workshop sessions get `startsAt`/`endsAt` filled in. The organiser fine-tunes on the grid.

## Key Decisions

- Each day has its own independent block list. A competition can span days (pool Day 1, bracket Day 2).
- Schedule tab splits into **Programme** + **Grid** sub-tabs (no new top-level nav tab).
- 15-second transition gap between consecutive matches on a lice (configurable per block, all timing configurable).
- Matches fed to the scheduler in `match_number_label ASC` order (Berger sequence) — caller-side sort, no scheduler algorithm change.
- Workshops gain an optional `duration_minutes` field. Workshop session `startsAt`/`endsAt` become nullable and are filled when the block is placed or generated.

## Data Model

### `event_programme_blocks` (new)

| column                   | type                 | notes                                             |
| ------------------------ | -------------------- | ------------------------------------------------- |
| `id`                     | uuid                 |                                                   |
| `event_id`               | uuid FK              |                                                   |
| `day_index`              | integer              | 0 = day 1                                         |
| `sort_order`             | integer              | drag-drop order within day                        |
| `block_type`             | text                 | `admin` \| `competition` \| `workshop` \| `break` |
| `label`                  | text                 |                                                   |
| `competition_id`         | uuid FK nullable     |                                                   |
| `competition_phase`      | text nullable        | `pool` \| `bracket` \| `finals`                   |
| `workshop_id`            | uuid FK nullable     |                                                   |
| `lice_count`             | integer              |                                                   |
| `start_time`             | time                 | HH:MM                                             |
| `end_time`               | time                 | HH:MM                                             |
| `match_gap_seconds`      | integer default 15   |                                                   |
| `match_duration_minutes` | integer default 5    |                                                   |
| `generated_at`           | timestamptz nullable |                                                   |

RLS: org members read, org admins write.

### Alterations to existing tables

- `workshops.duration_minutes` — nullable integer, set at workshop creation
- `workshop_sessions.starts_at`, `workshop_sessions.ends_at` — drop NOT NULL

## API

```
GET    /api/v1/events/:eventId/programme           list all blocks
PUT    /api/v1/events/:eventId/programme           bulk save (replace all blocks)
POST   /api/v1/events/:eventId/programme/suggest   auto-suggest (no DB write)
POST   /api/v1/events/:eventId/programme/generate  run scheduler + create sessions
```

### Suggest config (all configurable)

```ts
interface SuggestConfig {
  dayStartTime: string; // default "08:00"
  dayEndTime: string; // default "19:00"
  parallelLiceCount: number; // default = event lice count
  matchDurationMinutes: number; // default 5
  matchGapSeconds: number; // default 15
  breakBetweenSessionsMinutes: number; // default 20
  middayBreakStart: string; // default "12:00"
  middayBreakEnd: string; // default "13:00"
  registrationDurationMinutes: number; // default 60
  gearCheckDurationMinutes: number; // default 30
  refereeMeetingDurationMinutes: number; // default 30
}
```

### Suggest algorithm

1. Day 1 start: Registration+GearCheck block, then Referee Meeting block
2. For each competition ordered by `sort_order`: `needed_minutes = ceil(match_count / parallel_lice) × (match_duration + gap_sec/60)`
3. Pool blocks first, break after each, midday break inserted at configured window (splits any spanning block)
4. Bracket blocks after pools (may overflow to Day 2)
5. Workshops placed in remaining gaps
6. Overflow blocks flagged with `overflowMinutes > 0` and `suggestedEndTime`

### Generate

1. For each `competition` block: fetch matches ordered `match_number_label ASC`, call `scheduleMatches()` constrained to block time window
2. For each `workshop` block: upsert `workshop_session` with `startsAt`/`endsAt`
3. Set `generated_at` on all processed blocks

## Frontend

### Schedule page (`schedule/page.tsx`)

Split into two sub-tabs: **Programme** and **Grid** (existing content).

### Programme planner (`schedule/programme.tsx`)

- **Config bar** (collapsible): day times, lice count, durations — "Auto-suggest" button
- **Day tabs**: one per event day
- **Block list** per day: drag handle, time range (inline editable), type icon, label, lice badge, warning badge
- **Warning actions**: "Suggest fit" (auto-adjusts end time + downstream blocks) or "Override"
- **Action bar**: `+ Add block`, `Save programme`, `Generate schedule` (confirmation modal → redirects to Grid)

### Workshop creation form (`workshops/page.tsx`)

Add optional `Duration (min)` number input alongside capacity field.

## Files

| File                                                                    | Action                                 |
| ----------------------------------------------------------------------- | -------------------------------------- |
| `packages/db/migrations/0028_event_programme.sql`                       | Create                                 |
| `packages/types/src/programme.ts`                                       | Create                                 |
| `packages/types/src/index.ts`                                           | Modify                                 |
| `apps/api/src/modules/programme/`                                       | Create (module/service/controller/dto) |
| `apps/api/src/app.module.ts`                                            | Modify                                 |
| `apps/web-admin/app/org/[slug]/events/[eventId]/schedule/page.tsx`      | Modify                                 |
| `apps/web-admin/app/org/[slug]/events/[eventId]/schedule/programme.tsx` | Create                                 |
| `apps/web-admin/app/org/[slug]/events/[eventId]/workshops/page.tsx`     | Modify                                 |
| `packages/i18n/src/index.ts`                                            | Modify                                 |
| `docs/ARCHITECTURE.md`                                                  | Modify                                 |

## Verification

1. Migration applies cleanly — 1 new table, 3 column alterations
2. `POST /suggest` returns blocks with no DB writes; re-running gives same result
3. Day 1 suggestion starts with Registration, GearCheck, Referee Meeting
4. `needed_minutes` matches formula: `ceil(matches / lices) × (duration + gap/60)`
5. Midday break splits any block spanning it
6. Overflow block shows `overflowMinutes > 0` + `suggestedEndTime`
7. `POST /generate` assigns `scheduledAt` in Berger sequence order
8. Workshop session gets `startsAt`/`endsAt` from block position
9. Drag-drop reorders blocks; `PUT /programme` persists `sort_order`
10. Grid sub-tab shows matches after generation
11. Workshop form accepts `duration_minutes`; planner uses it for block sizing
