# Live control room — design

**Date:** 2026-07-21
**Status:** Approved (brainstorm) — ready for implementation plan
**Related:** remediation-plan items **G12** (Live control room) and **G13** (scorer→organizer
"needs attention" signal); depends on the Phase-5 staff-heartbeat columns.

## Context

An organizer running a HEMA event drives several pistes ("lices") at once. Volunteers score bouts
on tablets in a PWA (web-scoring). Today the organizer has **no live view**: to know a score they open
a public per-lice display tab; to know a tablet stopped syncing they find out when a bracket stalls; to
know a scorer needs help there is no channel at all. The gap-review promoted the deferred "control room"
into a first-class feature.

The Live control room is a **day-of, per-piste operations board** that answers three questions at once:

1. **Is anything broken?** — which tablet stopped syncing, which has a stuck queue, which scorer raised a
   "needs medic / head-ref / dispute" flag.
2. **How's the competition going?** — the live score, fighters, round and clock on every piste.
3. **Are we on time?** — what's running vs idle, and what's up next per piste.

All three are _per-piste_ views, so the board is **one row per lice** carrying all three lenses.

## Goals / non-goals

**v1 (this spec):**

- One authenticated organizer page: a wide board, one row per lice, all three lenses.
- **Realtime** live-score cells; **polled** health / attention / next-up.
- **Light actions only**: acknowledge an attention flag (the only in-board write) + deep-links out to the
  match / scorer / schedule pages that own real edits.
- New **"Live"** menu item in the event sidebar.

**Deferred (not v1):**

- Expandable row detail (inline exchange feed, health graph, scorer session history). — **shipped in
  v2**, as an in-place expansion; the row never navigates.
- Inline destructive actions (reassign scorer, force tablet reload, void/intervene on a match).
  — **partly shipped in v2: reassign scorer only.** See the reversal note below. Force-reload and
  void/intervene remain deferred.
- A dedicated read-only big-screen / TV-wall mode. — **shipped in v2** at `/display/wall/{eventId}`,
  outside the org route tree so it inherits the chromeless display layout.
- A hybrid/full client-side realtime store (see Alternatives).

> **v2 reversal — "No destructive edits here" (2026-08-06).** v1 ruled that every real edit happens
> on the page that owns it. That held for everything except assigning a scorer to a piste: the
> organizer who has just watched a piste go amber is standing at the board, and sending them to the
> Staff page to fix it costs them sight of every other piste at the moment they most need it. So
> `PUT /events/:eventId/live/lices/:liceId/scorer` exists and the row expansion offers it — scoped to
> that one operation, inside the expansion rather than on the collapsed row, and reporting any
> co-scorer it displaces rather than silently discarding another organizer's setup. The rest of the
> rule stands: force-reload, void and intervene are still owned by their own pages.

## Users & device

Primary: the **organizer / head referee at an ops table on a laptop** → the default layout is a **wide,
dense table** with every piste visible. Responsive down to a phone for walking the hall (stacked cards,
healthy pistes collapsed). No TV mode in v1.

## Architecture — two coordinated sources (Approach A)

Scores are **server-derived** (afterblow netting, round logic — raw button values are netted at read
time and persisted onto `matches.red_score` / `matches.blue_score`). Health/scorer/attention data is
**organizer-scoped** (RLS-protected). web-admin authenticates via API httpOnly cookies, and its browser
realtime client uses the **anon** key. Therefore each board row is fed by two sources:

### ① Authed board endpoint (poll ~7 s) — structural source of truth

`GET /events/:id/live-board` — gated by a new **event-scoped** org-role guard: resolve the event's
organization and `assertOrgRole(org, userId, 'scorekeeper')` (the same `assertOrgRole` the scoring helpers
use — **not** the match-keyed `authorizeMatchOrganizer`, since this route is event-scoped, mirroring the
remediation plan's C2 lesson). Returns, per lice:

```
{ lice: { id, name },
  currentMatch: { id, redFighter, blueFighter, redScore, blueScore, status, round, clockStatus } | null,
                 // clockStatus = running|paused|stopped. See "clock" note below — no ticking timer in v1.
  scorer:     { accountId, name, lastSeenAt } | null,   // +N indicator if >1 assigned
  health:     { outboxDepth, oldestPendingAgeSec, rejectedCount } | null,  // null = unknown, NOT healthy
  attention:  { flag: boolean, reason: 'medic'|'head_ref'|'dispute' } | null,
  nextUp:     { matchId, label } | null }
```

Assembled from paths that already exist: `getCurrentForLiceId` (current match per lice),
`event_staff_lice_assignments` (scorer→lice), plus the **new Phase-5 heartbeat columns** on
`event_staff_accounts` (`outbox_depth`, `oldest_pending_age_seconds`, `rejected_count`, `last_seen_at`)
and the **G13 `needs_attention` flag + reason**. This poll owns everything that changes _structurally_:
current-match rollover when a bout ends, scorer reassignment, health, attention, next-up.

### ② Anon realtime overlay — instant score cells

Reuse the existing browser client `apps/web-admin/src/lib/supabase-browser.ts` and the shared
`packages/ui/src/hooks/useLiveMatch.ts` pattern (subscribes to `matches`/`exchanges` `postgres_changes`,
with a `pollMs` fallback). Subscribe to `matches` changes for the current-match ids of the event; when
`red_score`/`blue_score`/`status`/`clock_status` change, patch **only that row's score/status cell** — no
refetch. On a `status → completed` change, trigger an **immediate** board refetch so the lice rolls to
the next bout without waiting for the poll. The sensitive data never rides realtime — only public,
anon-readable match scores do, which sidesteps realtime-RLS entirely.

### Component boundaries (each independently testable)

- **`LiveBoardService.assemble(eventId)`** (API) — builds the board payload.
- **`GET /events/:id/live-board`** — thin controller + org-role guard.
- **`useLiveBoard(eventId)`** (web-admin hook) — runs the poll, opens the realtime channel, merges
  realtime patches into row state, and reconciles on each poll.
- **`mergeRealtimePatch(boardState, matchChange)`** — a **pure function** carrying all merge logic (keeps
  the hard-to-test subscription thin).
- **`<LiveBoard>`** — presentational; renders rows from state, sort toggle, Ack.

## Navigation

Add a `live` item to `EVENT_NAV_GROUPS` in `apps/web-admin/src/components/event-nav-groups.ts` — a
prominent slot (its own entry near `EVENT_NAV_OVERVIEW`, or first in the `competition` group) — with a
new `organizer.eventHub.sections.live` label key in **EN + FR**, and update the route-completeness test
`event-nav-groups.test.ts` (it guards against dropped/duplicated routes and asserts every key resolves in
both locales). New route: `apps/web-admin/app/org/[slug]/events/[eventId]/live/page.tsx`.

## Layout

Wide table, **one row per piste, default sort = by piste number** (stable "find my piste"), with a
one-click **worst-first** toggle (attention → stuck → stale → running → idle). Guiding principle:
_nothing reads as fine unless proven fine_ — healthy rows are dimmed and the summary strip surfaces
problems regardless of sort order.

```
LIVE · Longsword Open          6 pistes · 5 running · 1 ⚠ needs attention · 1 tablet stale
                                                              sort: ⦿ by piste   ○ worst-first
────────────────────────────────────────────────────────────────────────────────────────────
    PISTE  MATCH (live score)        RND·STATUS SCORER         SYNC          ATTENTION      NEXT
────────────────────────────────────────────────────────────────────────────────────────────
🟢  P1     Marie D 3–2  Jean P.      R2 · run   Léa R · 2s     ● synced       —              #3  →  (dimmed)
🟠  P2     Amir K. 1–1  Sven L.      R1 · run   Tom H · 14m    ▲ 3q·40s       —              #7  →
🔴  P3     Ana R.  0–0  Ola B.       R1 · run   Ana M · 22m ⚠  ✖ 8q·2rej     🚑 MEDIC [Ack]  #5  →
⚪  P5     — idle —                  —          Noa F · 5s     ● synced       —              #2  →  (dimmed)
⚫  P6     — no scorer —             —          (unassigned)   —              —          [assign] →
```

(Shown in the default **by-piste** order — note the 🔴 problem on P3 sits mid-list; the worst-first
toggle floats it to the top, and the summary strip + red dot flag it either way.)

- **Left dot = health rollup:** 🔴 stuck / attention · 🟠 stale queue · 🟢 synced · ⚪ idle · ⚫ no
  scorer · **grey = unknown health** (see edge cases).
- **Score cell = realtime** (subtle pulse on change). Everything else is the 7 s poll.
- **`SYNC`** compact: `8q·2rej` = 8 queued, 2 rejected; `▲ 3q·40s` = 3 queued, oldest 40 s; `● synced`
  when empty.
- **`ATTENTION`** is the only in-board write: `[Ack]` clears the flag (optimistic). 🚑/⚖/👨‍⚖️ = medic /
  dispute / head-ref.
- **Row → deep-links:** piste/match → match page, scorer → Staff, `[assign]`/`NEXT` → schedule.
  (v2: the row also expands in place; assigning a scorer is the one destructive edit it offers —
  see the reversal note above.)

**Responsive (< `md`):** rows become stacked cards, worst-first, healthy pistes folded into a
"🟢 4 pistes synced ▸" expander so only problems show.

## Interactions

- **Acknowledge attention** — `POST` to clear `needs_attention` (optimistic; revert + toast on failure;
  if the scorer re-raises, the next poll re-surfaces it).
- **Deep-links** — `Link` to `/matches/[id]`, `/staff`, `/schedule`. All real/destructive edits happen on
  the page that owns them.

## Edge cases & failure modes

- **Unknown health ≠ healthy.** No heartbeat yet (old build, feature not deployed, just logged in) →
  **grey "unknown"**, never green. A false green is the one failure that defeats the board.
- **Socket drops → poll carries on** (scores update every 7 s instead of instantly) with a "reconnecting"
  cue on score cells (existing connection-cue pattern).
- **Poll fails → last-known data dimmed** + "couldn't refresh — retrying" strip + backoff. Never blank.
- **Instant rollover** on `matches status → completed` realtime event (immediate refetch).
- **No scorer on an active lice** → ⚫ flagged (ops problem, not hidden). **Multiple scorers** → active/
  most-recent + "+N". **Idle lice** → ⚪ + next-up.
- **Event not running** (draft/pre-start/completed/archived) → board renders with an "event not live"
  banner; rows idle. Menu item always present.
- **Stale vs stuck thresholds** (tunable, not magic): _stale_ = oldest-pending > 60 s or last-seen >
  ~2× heartbeat interval; _stuck_ = rejectedCount > 0, or oldest-pending > 5 min, or last-seen > the
  event's idle-timeout (Phase-5 config).
- **Authz** → non-org-role caller → 403 → access-denied state.
- **Clock is status, not a stopwatch (v1 limitation).** The match clock ticks locally on the scoring
  tablet; the board shows **round + running/paused/stopped status** (and optionally "started N min ago"),
  not a precisely-ticking per-row timer. The operational need is "is this bout live and roughly where,"
  not a synchronized stopwatch — a ticking timer is deferred.

## Dependencies

- **Phase-5 staff heartbeat** (remediation plan): the tablet's activity ping must report
  `outbox_depth` / `oldest_pending_age_seconds` / `rejected_count` alongside `last_seen_at` on
  `event_staff_accounts`. Until it ships, health shows **unknown** (grey) and the board still delivers
  scores + throughput + presence.
- **G13 `needs_attention`** flag + reason column and the scorer's pad button (Phase 7). The board reads
  and acknowledges the flag.

## Reused building blocks (do not reinvent)

- `apps/web-admin/src/lib/supabase-browser.ts` — anon browser realtime client.
- `packages/ui/src/hooks/useLiveMatch.ts` — `matches`/`exchanges` subscription + poll fallback pattern.
- `matches.red_score` / `blue_score` — the netted display score on the row (realtime carries it).
- `staff.service.ts` `getCurrentForLiceId`, `event_staff_lice_assignments`, and `assertOrgRole` (the
  org-role check — the board uses an event-scoped guard, not the match-keyed `authorizeMatchOrganizer`).
- `EVENT_NAV_GROUPS` (`event-nav-groups.ts`) + `event-nav-groups.test.ts`.

## Testing

- **`LiveBoardService.assemble`** — fixtures over every row state (running / idle / no-scorer / attention
  / health-present / health-absent / multi-scorer); authz (non-organizer → 403); current-match-per-lice +
  scorer-join + health-column query shape.
- **`mergeRealtimePatch`** (pure) — patches only the target row; poll reconciles; completed → refetch
  fires.
- **`useLiveBoard`** — poll + socket-down fallback + debounced refetch.
- **`<LiveBoard>`** — every row state renders; sort toggle (piste ↔ worst-first); Ack optimistic +
  revert-on-failure; **unknown-health-is-not-green** assertion.
- **Nav** — `event-nav-groups.test.ts` updated for the `live` route + EN/FR keys.

## Alternatives considered

- **Approach B — authoritative aggregate + realtime-as-invalidation** (realtime only triggers a refetch).
  Simplest and keeps scoring authoritative, but the score cell isn't genuinely instant. Rejected in favour
  of instant score cells.
- **Approach C — full client-side realtime store.** Maximally live, but re-implements server-side score
  derivation and must solve realtime auth for organizer-scoped rows. Rejected — highest complexity for an
  ops board.

## Open decisions (defer to implementation, non-blocking)

- Poll interval (5–10 s) — start at 7 s, tune from real load.
- Whether worst-first should become the default once organizers use it in anger.
- Exact nav slot (ungrouped top vs first in Competition).
