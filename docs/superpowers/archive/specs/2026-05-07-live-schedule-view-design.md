# Spec: Live Schedule View (T-1211) — 2026-05-07

## Context

Tournament attendees (fighters, referees, workshop participants) and organisers need a way to see what is happening _right now_ during an event — which programme section is active and which fight is on which piste. Built on top of T-1210 (programme blocks) and the existing schedule grid (T-706).

---

## Decisions Made

- **Where**: Option C — "Now Playing" collapsible banner in web-admin schedule page + new `/live` public page in web-public
- **Block detection**: Option A — clock-based only (compare wall clock against `event_programme_blocks.start_time`/`end_time` + `day_index`)
- **Idle lice**: Option C — show running match if any; fall back to "Next up" with match label + fighters
- **Public page layout**: Option C — all-lices overview + tap to drill into a single lice
- **Realtime strategy**: Option C — Supabase Realtime `lice:{liceId}:current` channel per lice for match changes + 30s client-side timer for block re-evaluation

---

## Section 1 — API

### New endpoint: `GET /api/v1/events/:eventId/live-state`

Added to the existing `ScheduleModule` / `LiveStateController`.

**Response shape:**

```ts
interface LiveStateResponse {
  currentBlock: ProgrammeBlock | null; // block whose start_time ≤ now ≤ end_time for today
  nextBlock: ProgrammeBlock | null; // earliest future block today
  lices: LiveLiceState[];
}

interface LiveLiceState {
  lice: { id: string; name: string; sortOrder: number };
  runningMatch: LiveMatch | null; // status = 'running'
  nextMatch: LiveMatch | null; // earliest scheduled match after now
}

interface LiveMatch {
  id: string;
  matchNumberLabel: string;
  redFighterName: string | null;
  blueFighterName: string | null;
  scheduledAt: string | null;
  status: string;
  tournamentName: string | null;
}
```

No new DB table — pure read from `event_programme_blocks`, `lices`, `matches`.

Block detection: convert `day_index` + event `start_date` + block `start_time`/`end_time` to absolute timestamps; compare against `now()`.

---

## Section 2 — web-admin: LiveNowBanner

New component `live-now-banner.tsx` added to the schedule folder. Rendered above both Programme/Grid sub-tabs in `schedule/page.tsx`.

**Expanded view:**

- Block row: current block label + type icon + time remaining, or "Between sessions"
- Per-lice row: lice name + LIVE badge + match label + fighters (if running), or "Next: [label] · Red vs Blue" (if idle)

**Collapsed view:** single line "● LIVE — [block name]" with expand chevron.

State managed by `useLiveState(eventId)` custom hook that:

1. Calls `GET /live-state` on mount
2. Subscribes to `lice:{id}:current` broadcast channel per lice
3. Runs `setInterval(30_000)` to re-evaluate current block from loaded block list

---

## Section 3 — web-public: `/live` page

New route: `apps/web-public/app/e/[eventSlug]/live/page.tsx`

**Overview mode** (no `?lice=` param):

- Current block name prominently, or "Between sessions"
- Card grid — one card per lice: LIVE badge + match label + fighters, or "Next: …"
- Tap card → drill-down

**Drill-down mode** (`?lice=<liceId>`):

- Back button
- Running match card with LIVE badge (or "No active match")
- "Up next" — next 3 matches on this lice

Shares `useLiveState` hook (extracted to `packages/` or co-located). Public route, no login required. Updates via same Realtime + timer strategy.

A "Live schedule →" link added to the event home stub.

---

## Files to Create / Modify

| File                                                                          | Action                         |
| ----------------------------------------------------------------------------- | ------------------------------ |
| `apps/api/src/modules/schedule/live-state.service.ts`                         | Create                         |
| `apps/api/src/modules/schedule/live-state.controller.ts`                      | Create                         |
| `apps/api/src/modules/schedule/schedule.module.ts`                            | Modify — register LiveState\*  |
| `apps/web-admin/app/org/[slug]/events/[eventId]/schedule/live-now-banner.tsx` | Create                         |
| `apps/web-admin/app/org/[slug]/events/[eventId]/schedule/page.tsx`            | Modify — add banner            |
| `apps/web-public/app/e/[eventSlug]/live/page.tsx`                             | Create                         |
| `apps/web-public/app/e/[eventSlug]/page.tsx`                                  | Modify — add live link         |
| `docs/ARCHITECTURE.md`                                                        | Modify — live schedule section |
