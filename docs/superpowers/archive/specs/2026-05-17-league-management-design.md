# League Management — Design Spec

> **Status (2026-07-01 doc review):** Shipped — capabilities landed, but the admin UI is now split across multiple routes (`new/`, `[id]/edit/`, `[id]/requests/`, `scoring-systems/`) rather than the single `page.tsx` this spec describes. Audited against code.

_2026-05-17_

## Context

The `/admin/leagues` page lets super-admins create leagues and review tournament attachment requests. The current form is bare: slug must be typed manually, there is no editing or deletion, tournaments can only be attached via an organiser-initiated request flow, and scoring config is hardcoded. This spec covers a full management overhaul.

---

## Scope

Six capabilities added to the admin league UI under `apps/web-admin/app/admin/leagues/`. (As shipped, this UI is split across route files — `page.tsx` (list), `new/page.tsx` (create + slug auto-gen), `[id]/edit/page.tsx` (edit + scoring), `[id]/requests/page.tsx`, and `scoring-systems/**` — plus a shared `league-utils.ts`; the per-section "single `page.tsx`" notes below predate that split.)

1. Slug auto-generation from the league name
2. Inline league editing (name, description, status, visibility)
3. League deletion
4. Inline scoring config editor (preset vs custom points-by-rank)
5. Remove individual tournament links / bulk-remove all links for an event
6. Admin-initiated tournament addition via fuzzy event/tournament search

---

## 1. Slug Auto-Generation

**Behaviour:** As the admin types the league name, the slug field auto-fills using `toSlug(name)`. If the admin edits the slug field directly, it detaches silently and stops following the name (Option A — silent detach on edit). On successful create the detached flag resets.

**Slug function:**

```ts
function toSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics (French support)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

**State:**

```ts
const [slugDetached, setSlugDetached] = useState(false);
```

Name onChange → if not detached, set `slug = toSlug(name)`.  
Slug onChange → set `slugDetached = true`, update slug.  
Post-create reset → clear name, slug, and reset `slugDetached = false`.

**Files:** `apps/web-admin/app/admin/leagues/new/page.tsx` (create form) with `toSlug`/`slugDetached` logic in the shared `apps/web-admin/app/admin/leagues/league-utils.ts`.

---

## 2. Inline League Editing

Each league card gets an **Edit** toggle. When open, it shows:

| Field             | Control                              | API field          |
| ----------------- | ------------------------------------ | ------------------ |
| Name              | text input                           | `name`             |
| Description       | textarea                             | `description`      |
| Status            | select: draft / published / archived | `status`           |
| Public visibility | checkbox                             | `publicVisibility` |

**Save** calls `PATCH /api/v1/admin/leagues/:leagueId` with `UpdateLeagueDto`. On success the card refreshes from the response; the edit panel collapses. Cancel discards local state.

**Files:** `apps/web-admin/app/admin/leagues/[id]/edit/page.tsx`.

---

## 3. League Deletion

Each card has a **Delete** button. It calls `window.confirm`, then `DELETE /api/v1/admin/leagues/:leagueId`. On success the card is removed from the list.

**New backend — service** (`apps/api/src/modules/leagues/leagues.service.ts`):

```ts
async delete(leagueId: string, userId: string): Promise<void> {
  await this.assertCanManageLeague(leagueId, userId);
  const { error } = await this.supabase.service
    .from('leagues')
    .delete()
    .eq('id', leagueId);
  if (error) throw new BadRequestException(error.message);
}
```

**New backend — controller** (`apps/api/src/modules/leagues/leagues.controller.ts`):

```ts
@Delete('admin/leagues/:leagueId')
@HttpCode(HttpStatus.NO_CONTENT)
async deleteLeague(@Param('leagueId', ParseUUIDPipe) leagueId: string, @Req() req: FastifyRequest) {
  const userId = await getUserId(req, this.supabase);
  return this.leagues.delete(leagueId, userId);
}
```

**Files:**

- `apps/api/src/modules/leagues/leagues.service.ts`
- `apps/api/src/modules/leagues/leagues.controller.ts`

---

## 4. Scoring Config Editor

Shown as a subsection inside the league edit panel (same toggle as §2).

**Controls:**

- **System selector** — two options: `FFAMHE TF 2026 (preset)` or `Custom`
- **Points table** (Custom only) — two-column table: Rank | Points. Editable Points column. "Add row" button appends a new pair. Each row has a remove button. Pre-populated with the ffamhe_tf_2026 values on first switch to Custom (rank 1→16 pts … rank 16→1 pt).

**Save** sends `scoringConfig` inside the existing `UpdateLeagueDto.scoringConfig`:

```ts
{
  scoringSystem: 'custom',          // or 'ffamhe_tf_2026'
  rankingDimensions: league.ranking_dimensions,  // preserved from current value
  customPointsByRank: { 1: 16, 2: 15, ... },     // custom only
  tieBreakers: [...]                              // preserved from current value
}
```

No new backend code. `UpdateLeagueDto.scoringConfig` already accepts `LeagueScoringConfig`.

**Files:** `apps/web-admin/app/admin/leagues/[id]/edit/page.tsx` (and `new/page.tsx` for the create form).

---

## 5. Remove Tournament Links

### 5a. Individual remove

Each tournament link row (regardless of current status) gets a **Remove** button.  
Calls existing `PATCH /api/v1/admin/league-tournament-links/:linkId` with `{ status: 'removed' }`.  
Removed links are shown greyed out (history preserved, no further actions available).

The frontend `TournamentLink` interface gains `events.id` and `tournaments.id` (already returned by the API but not typed):

```ts
interface TournamentLink {
  id: string;
  status: 'requested' | 'approved' | 'rejected' | 'removed';
  tournaments?: {
    id?: string | null;
    name?: string | null;
    weapon?: string | null;
    category?: string | null;
    events?: { id?: string | null; name?: string | null } | null;
  } | null;
}
```

### 5b. Bulk remove by event

Links are grouped by event name in the display. Each event group header shows a **"Remove all"** button that calls:

`DELETE /api/v1/admin/leagues/:leagueId/events/:eventId/tournament-links`

**New backend — service:**

```ts
async removeEventTournamentLinks(leagueId: string, eventId: string, userId: string) {
  await this.assertCanManageLeague(leagueId, userId);
  const { data: links } = await this.supabase.service
    .from('league_tournament_links')
    .select('id, tournaments!inner(event_id)')
    .eq('league_id', leagueId)
    .eq('tournaments.event_id', eventId)
    .neq('status', 'removed');
  for (const link of (links ?? []) as Row[]) {
    await this.reviewTournamentLink(String(link['id']), 'removed', userId);
  }
}
```

**New backend — controller:**

```ts
@Delete('admin/leagues/:leagueId/events/:eventId/tournament-links')
@HttpCode(HttpStatus.NO_CONTENT)
async removeEventLinks(
  @Param('leagueId', ParseUUIDPipe) leagueId: string,
  @Param('eventId', ParseUUIDPipe) eventId: string,
  @Req() req: FastifyRequest,
) {
  const userId = await getUserId(req, this.supabase);
  return this.leagues.removeEventTournamentLinks(leagueId, eventId, userId);
}
```

**Files:**

- `apps/api/src/modules/leagues/leagues.service.ts`
- `apps/api/src/modules/leagues/leagues.controller.ts`
- `apps/web-admin/app/admin/leagues/[id]/edit/page.tsx`

---

## 6. Admin-Initiated Tournament Addition (Fuzzy Search)

Each league card gets an **"Add tournaments"** toggle panel.

### UX flow

1. Panel opens → fetch all events via `GET /api/v1/events` (no auth required, public endpoint)
2. Search box filters events client-side: normalize both strings (lowercase + NFD strip), check if all typed chars appear as a subsequence in the event name
3. Each matching event row shows:
   - Event name + **"Add all"** button (links all tournaments for that event)
   - Expand arrow → fetches `GET /api/v1/events/:eventId/tournaments` on first expand → lists individual tournaments each with an **"Add"** button
4. Already-linked tournaments (ids in `links[leagueId]`) are shown as disabled/greyed

### Backend — direct approved link

**New service method:**

```ts
async addTournamentLink(leagueId: string, tournamentId: string, userId: string) {
  await this.assertCanManageLeague(leagueId, userId);
  const { data, error } = await this.supabase.service
    .from('league_tournament_links')
    .upsert(
      { league_id: leagueId, tournament_id: tournamentId, status: 'approved',
        reviewed_by_user_id: userId, reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString() },
      { onConflict: 'league_id,tournament_id' },
    )
    .select('*').single();
  if (error) throw new BadRequestException(error.message);
  return data;
}
```

**Bulk-event service method:**

```ts
async addEventTournamentLinks(leagueId: string, eventId: string, userId: string) {
  await this.assertCanManageLeague(leagueId, userId);
  const { data: tournaments } = await this.supabase.service
    .from('tournaments').select('id').eq('event_id', eventId);
  for (const t of (tournaments ?? []) as Row[]) {
    await this.addTournamentLink(leagueId, String(t['id']), userId);
  }
}
```

**New controller endpoints:**

```ts
@Post('admin/leagues/:leagueId/tournaments/:tournamentId/link')
@HttpCode(HttpStatus.CREATED)
async addTournamentLink(...)  // calls leagues.addTournamentLink

@Post('admin/leagues/:leagueId/events/:eventId/link')
@HttpCode(HttpStatus.CREATED)
async addEventLinks(...)       // calls leagues.addEventTournamentLinks
```

**Files:**

- `apps/api/src/modules/leagues/leagues.service.ts`
- `apps/api/src/modules/leagues/leagues.controller.ts`
- `apps/web-admin/app/admin/leagues/[id]/edit/page.tsx`

---

## Files Modified

| File                                                 | Changes                                                                                                                                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web-admin/app/admin/leagues/` (route tree)     | All UI, split across `page.tsx` (list + delete), `new/page.tsx` (create + slug auto-gen), `[id]/edit/page.tsx` (edit, scoring editor, remove links, fuzzy add), plus shared `league-utils.ts` |
| `apps/api/src/modules/leagues/leagues.service.ts`    | Add `delete`, `removeEventTournamentLinks`, `addTournamentLink`, `addEventTournamentLinks`                                                                                                    |
| `apps/api/src/modules/leagues/leagues.controller.ts` | Add `DELETE /leagues/:id`, `DELETE /leagues/:id/events/:eid/tournament-links`, `POST /leagues/:id/tournaments/:tid/link`, `POST /leagues/:id/events/:eid/link`                                |

No database migrations needed. No new packages needed.

---

## Verification

1. **Slug auto-gen** — type a name with accents ("Ligue HÉMA 2026"), confirm slug auto-fills as `ligue-hema-2026`. Edit the slug manually, confirm it stops following the name.
2. **Edit** — open edit panel, change name/description/status/visibility, save. Confirm card reflects new values without page reload.
3. **Delete** — click Delete, cancel confirm → nothing happens. Confirm → card disappears.
4. **Scoring config** — switch to Custom, verify pre-fill matches ffamhe_tf_2026 table (1→16, 2→15 … 16→1). Edit a rank, save, recompute, confirm new points appear in standings.
5. **Remove link** — click Remove on an approved link, confirm it turns greyed/removed.
6. **Bulk remove** — click "Remove all" on an event group, confirm all its links turn removed.
7. **Fuzzy add** — type partial event name, confirm results filter. Expand event, add one tournament. Confirm link appears as approved in the links list. Test "Add all" for an event.
