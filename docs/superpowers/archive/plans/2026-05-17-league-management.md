# League Management Implementation Plan

> **Status (2026-08-19):** Shipped, then extended — `apps/web-admin/app/admin/leagues/` holds `new/`, `[id]/`, `scoring-systems/` and a `league-utils.ts` with its own tests, rather than the single page this plan sketched. Historical record; do not execute.

**Goal:** Add full league management to `/admin/leagues` — slug auto-gen, inline editing, deletion, scoring config editor, tournament link removal, and admin-initiated fuzzy tournament addition.

**Architecture:** Backend gains 4 new endpoints (delete league, bulk-remove event links, direct-add one tournament, direct-add whole event) in the existing NestJS controller/service pair. Frontend is entirely in one page file + a small extracted utilities file for pure functions (toSlug, fuzzyMatch). All new state is local React state — no external state library.

**Tech Stack:** NestJS (backend), React/Next.js with TypeScript (frontend), Supabase JS client (data), Tailwind CSS (styling), Vitest (tests)

---

## File Map

| File                                                    | Action | Responsibility                                                                             |
| ------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| `apps/api/src/modules/leagues/leagues.service.ts`       | Modify | Add `delete`, `removeEventTournamentLinks`, `addTournamentLink`, `addEventTournamentLinks` |
| `apps/api/src/modules/leagues/leagues.controller.ts`    | Modify | Add 4 new endpoints                                                                        |
| `apps/web-admin/app/admin/leagues/league-utils.ts`      | Create | Pure functions: `toSlug`, `fuzzyMatch`, `FFAMHE_POINTS` constant                           |
| `apps/web-admin/app/admin/leagues/league-utils.test.ts` | Create | Unit tests for the pure functions                                                          |
| `apps/web-admin/app/admin/leagues/page.tsx`             | Modify | All UI features, imports `league-utils.ts`                                                 |

---

## Task 1: Extract Pure Utilities + Unit Tests

**Files:**

- Create: `apps/web-admin/app/admin/leagues/league-utils.ts`
- Create: `apps/web-admin/app/admin/leagues/league-utils.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `apps/web-admin/app/admin/leagues/league-utils.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FFAMHE_POINTS, fuzzyMatch, toSlug } from './league-utils';

describe('toSlug', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(toSlug('France League 2026')).toBe('france-league-2026');
  });
  it('strips French diacritics', () => {
    expect(toSlug('Ligue HÉMA')).toBe('ligue-hema');
  });
  it('collapses consecutive non-alphanumeric chars into one hyphen', () => {
    expect(toSlug('Hello  World!')).toBe('hello-world');
  });
  it('trims leading and trailing hyphens', () => {
    expect(toSlug('  Hello ')).toBe('hello');
  });
  it('handles empty string', () => {
    expect(toSlug('')).toBe('');
  });
});

describe('fuzzyMatch', () => {
  it('matches when all query chars appear in order', () => {
    expect(fuzzyMatch('fal', 'FAL 2026')).toBe(true);
  });
  it('strips diacritics in both strings', () => {
    expect(fuzzyMatch('hema', 'HÉMA France')).toBe(true);
  });
  it('returns false when a char is missing', () => {
    expect(fuzzyMatch('xyz', 'FAL 2026')).toBe(false);
  });
  it('returns true for empty query', () => {
    expect(fuzzyMatch('', 'anything')).toBe(true);
  });
});

describe('FFAMHE_POINTS', () => {
  it('gives rank 1 → 16 points', () => {
    expect(FFAMHE_POINTS[1]).toBe(16);
  });
  it('gives rank 16 → 1 point', () => {
    expect(FFAMHE_POINTS[16]).toBe(1);
  });
  it('has exactly 16 entries', () => {
    expect(Object.keys(FFAMHE_POINTS).length).toBe(16);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd "f:\Github Repo\MyClash"
pnpm --filter web-admin test league-utils
```

Expected: error `Cannot find module './league-utils'`

- [ ] **Step 3: Implement the utilities**

Create `apps/web-admin/app/admin/leagues/league-utils.ts`:

```ts
export const FFAMHE_POINTS: Record<number, number> = {
  1: 16,
  2: 15,
  3: 14,
  4: 13,
  5: 12,
  6: 11,
  7: 10,
  8: 9,
  9: 8,
  10: 7,
  11: 6,
  12: 5,
  13: 4,
  14: 3,
  15: 2,
  16: 1,
};

export function toSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function fuzzyMatch(query: string, target: string): boolean {
  const q = query.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const t = target.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
pnpm --filter web-admin test league-utils
```

Expected: 8 tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/web-admin/app/admin/leagues/league-utils.ts apps/web-admin/app/admin/leagues/league-utils.test.ts
git commit -m "feat: add toSlug and fuzzyMatch utilities for league admin"
```

---

## Task 2: Backend — Delete League

**Files:**

- Modify: `apps/api/src/modules/leagues/leagues.service.ts`
- Modify: `apps/api/src/modules/leagues/leagues.controller.ts`

- [ ] **Step 1: Add `delete` method to the service**

In `apps/api/src/modules/leagues/leagues.service.ts`, add after the `update` method (around line 159):

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

- [ ] **Step 2: Add `Delete` to controller imports and add the endpoint**

In `apps/api/src/modules/leagues/leagues.controller.ts`, update the import at line 1:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
```

Then add after the `update` endpoint (around line 113):

```ts
@Delete('admin/leagues/:leagueId')
@HttpCode(HttpStatus.NO_CONTENT)
@ApiBearerAuth()
@ApiOperation({ summary: 'Delete a league' })
async deleteLeague(
  @Param('leagueId', ParseUUIDPipe) leagueId: string,
  @Req() req: FastifyRequest,
) {
  const userId = await getUserId(req, this.supabase);
  return this.leagues.delete(leagueId, userId);
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd "f:\Github Repo\MyClash"
pnpm --filter api tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/leagues/leagues.service.ts apps/api/src/modules/leagues/leagues.controller.ts
git commit -m "feat: add DELETE /admin/leagues/:leagueId endpoint"
```

---

## Task 3: Backend — Remove Event Tournament Links

**Files:**

- Modify: `apps/api/src/modules/leagues/leagues.service.ts`
- Modify: `apps/api/src/modules/leagues/leagues.controller.ts`

- [ ] **Step 1: Add `removeEventTournamentLinks` to the service**

In `apps/api/src/modules/leagues/leagues.service.ts`, add after the `reviewTournamentLink` method (around line 245):

```ts
async removeEventTournamentLinks(
  leagueId: string,
  eventId: string,
  userId: string,
): Promise<void> {
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

- [ ] **Step 2: Add the endpoint to the controller**

In `apps/api/src/modules/leagues/leagues.controller.ts`, add after `deleteLeague`:

```ts
@Delete('admin/leagues/:leagueId/events/:eventId/tournament-links')
@HttpCode(HttpStatus.NO_CONTENT)
@ApiBearerAuth()
@ApiOperation({ summary: 'Remove all tournament links for an event from a league' })
async removeEventTournamentLinks(
  @Param('leagueId', ParseUUIDPipe) leagueId: string,
  @Param('eventId', ParseUUIDPipe) eventId: string,
  @Req() req: FastifyRequest,
) {
  const userId = await getUserId(req, this.supabase);
  return this.leagues.removeEventTournamentLinks(leagueId, eventId, userId);
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter api tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/leagues/leagues.service.ts apps/api/src/modules/leagues/leagues.controller.ts
git commit -m "feat: add bulk remove event tournament links endpoint"
```

---

## Task 4: Backend — Admin Direct-Add Tournament Links

**Files:**

- Modify: `apps/api/src/modules/leagues/leagues.service.ts`
- Modify: `apps/api/src/modules/leagues/leagues.controller.ts`

- [ ] **Step 1: Add `addTournamentLink` and `addEventTournamentLinks` to the service**

In `apps/api/src/modules/leagues/leagues.service.ts`, add after `removeEventTournamentLinks`:

```ts
async addTournamentLink(
  leagueId: string,
  tournamentId: string,
  userId: string,
) {
  await this.assertCanManageLeague(leagueId, userId);
  const { data, error } = await this.supabase.service
    .from('league_tournament_links')
    .upsert(
      {
        league_id: leagueId,
        tournament_id: tournamentId,
        status: 'approved',
        reviewed_by_user_id: userId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'league_id,tournament_id' },
    )
    .select('*')
    .single();
  if (error) throw new BadRequestException(error.message);
  return data;
}

async addEventTournamentLinks(
  leagueId: string,
  eventId: string,
  userId: string,
) {
  await this.assertCanManageLeague(leagueId, userId);
  const { data: tournaments, error } = await this.supabase.service
    .from('tournaments')
    .select('id')
    .eq('event_id', eventId);
  if (error) throw new BadRequestException(error.message);
  for (const t of (tournaments ?? []) as Row[]) {
    await this.addTournamentLink(leagueId, String(t['id']), userId);
  }
}
```

- [ ] **Step 2: Add the two endpoints to the controller**

In `apps/api/src/modules/leagues/leagues.controller.ts`, add after `removeEventTournamentLinks`:

```ts
@Post('admin/leagues/:leagueId/tournaments/:tournamentId/link')
@HttpCode(HttpStatus.CREATED)
@ApiBearerAuth()
@ApiOperation({ summary: 'Admin direct-add a tournament to a league (approved immediately)' })
async addTournamentLink(
  @Param('leagueId', ParseUUIDPipe) leagueId: string,
  @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
  @Req() req: FastifyRequest,
) {
  const userId = await getUserId(req, this.supabase);
  return this.leagues.addTournamentLink(leagueId, tournamentId, userId);
}

@Post('admin/leagues/:leagueId/events/:eventId/link')
@HttpCode(HttpStatus.CREATED)
@ApiBearerAuth()
@ApiOperation({ summary: 'Admin direct-add all tournaments from an event to a league' })
async addEventTournamentLinks(
  @Param('leagueId', ParseUUIDPipe) leagueId: string,
  @Param('eventId', ParseUUIDPipe) eventId: string,
  @Req() req: FastifyRequest,
) {
  const userId = await getUserId(req, this.supabase);
  return this.leagues.addEventTournamentLinks(leagueId, eventId, userId);
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter api tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/leagues/leagues.service.ts apps/api/src/modules/leagues/leagues.controller.ts
git commit -m "feat: add admin direct-add tournament/event link endpoints"
```

---

## Task 5: Frontend — Interfaces, State Shape, and Slug Auto-Gen

**Files:**

- Modify: `apps/web-admin/app/admin/leagues/page.tsx`

This task refactors the top of the file: imports, interfaces, constants, and form/slug state. Later tasks build on this foundation.

- [ ] **Step 1: Update imports at the top of the page**

Replace the existing import block at the top of `apps/web-admin/app/admin/leagues/page.tsx`:

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { t } from '@myclash/i18n';
import { FFAMHE_POINTS, fuzzyMatch, toSlug } from './league-utils';
```

- [ ] **Step 2: Replace the `League` interface (currently lines 7–15) with the extended version**

```ts
interface League {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  season_year: number;
  status: string;
  public_visibility: boolean;
  scoring_system: string;
  scoring_config: {
    scoringSystem: 'ffamhe_tf_2026' | 'custom';
    rankingDimensions: 'weapon' | 'weapon_category';
    customPointsByRank?: Record<number, number>;
    tieBreakers: string[];
  } | null;
}
```

- [ ] **Step 3: Replace the `TournamentLink` interface to add event and tournament ids**

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

- [ ] **Step 4: Add `slugDetached` state and update the form state block**

Inside `AdminLeaguesPage`, add `slugDetached` state immediately after the existing `form` state:

```ts
const [slugDetached, setSlugDetached] = useState(false);
```

- [ ] **Step 5: Update the name input onChange to auto-fill slug**

Find the name input (currently around line 129) and replace its `onChange`:

```tsx
onChange={(event) => {
  const name = event.target.value;
  setForm((f) => ({ ...f, name, slug: slugDetached ? f.slug : toSlug(name) }));
}}
```

- [ ] **Step 6: Update the slug input onChange to detach on manual edit**

Find the slug input (currently around line 136) and replace its `onChange`:

```tsx
onChange={(event) => {
  setSlugDetached(true);
  setForm((f) => ({ ...f, slug: event.target.value }));
}}
```

- [ ] **Step 7: Reset `slugDetached` after successful create**

Inside `createLeague`, update the `.then` success handler:

```ts
.then((res) => {
  if (!res.ok) throw new Error(t('admin.leagues.createError'));
  setSlugDetached(false);
  setForm((current) => ({ ...current, name: '', slug: '' }));
  load();
})
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
pnpm --filter web-admin tsc --noEmit
```

Expected: no errors

- [ ] **Step 9: Manual smoke test — slug auto-gen**

Start the admin app (`pnpm --filter web-admin dev`), navigate to `/admin/leagues`, type "Ligue HÉMA France 2026" in the name field. Confirm the slug auto-fills as `ligue-hema-france-2026`. Manually edit the slug, then keep typing the name — confirm slug stops updating.

- [ ] **Step 10: Commit**

```bash
git add apps/web-admin/app/admin/leagues/page.tsx
git commit -m "feat: slug auto-generation from league name with silent detach"
```

---

## Task 6: Frontend — Inline Edit Panel (Name, Description, Status, Visibility)

**Files:**

- Modify: `apps/web-admin/app/admin/leagues/page.tsx`

- [ ] **Step 1: Add edit state**

Inside `AdminLeaguesPage`, add after the `slugDetached` state:

```ts
const [editId, setEditId] = useState<string | null>(null);
const [editForm, setEditForm] = useState<{
  name: string;
  description: string;
  status: string;
  publicVisibility: boolean;
}>({ name: '', description: '', status: 'draft', publicVisibility: false });
```

- [ ] **Step 2: Add `openEdit` and `saveEdit` helpers**

Add inside `AdminLeaguesPage` before the return statement:

```ts
const openEdit = (league: League) => {
  setEditId(league.id);
  setEditForm({
    name: league.name,
    description: league.description ?? '',
    status: league.status,
    publicVisibility: league.public_visibility,
  });
};

const saveEdit = () => {
  if (!editId) return;
  fetch(`${apiUrl}/api/v1/admin/leagues/${editId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: editForm.name,
      description: editForm.description || undefined,
      status: editForm.status,
      publicVisibility: editForm.publicVisibility,
    }),
  })
    .then((res) => {
      if (!res.ok) throw new Error('Update failed');
      setEditId(null);
      load();
    })
    .catch(() => setError('Failed to update league'));
};
```

- [ ] **Step 3: Add edit panel JSX to each league card**

Inside the `leagues.map(...)` block, after the existing action buttons `<div>`, add the edit toggle button and panel. Replace the existing card header `<div className="flex flex-wrap items-start justify-between gap-4">` block with:

```tsx
<div className="flex flex-wrap items-start justify-between gap-4">
  <div>
    <h2 className="font-semibold text-gray-950">{league.name}</h2>
    <p className="text-sm text-gray-500">
      {league.season_year} -{' '}
      {league.public_visibility ? t('admin.leagues.public') : t('admin.leagues.private')}
      {' — '}
      <span className="capitalize">{league.status}</span>
    </p>
  </div>
  <div className="flex flex-wrap gap-2">
    <Link className="text-sm underline" href={`/leagues/${league.slug}`}>
      {t('admin.leagues.standings')}
    </Link>
    <a
      className="text-sm underline"
      href={`${apiUrl}/api/v1/leagues/${league.id}/final-report.csv`}
    >
      {t('admin.leagues.csvReport')}
    </a>
    <a
      className="text-sm underline"
      href={`${apiUrl}/api/v1/leagues/${league.id}/final-report.print.html`}
    >
      {t('admin.leagues.printReport')}
    </a>
    <button className="text-sm underline" onClick={() => recompute(league.id)}>
      {t('admin.leagues.recompute')}
    </button>
    <button
      className="text-sm underline"
      onClick={() => (editId === league.id ? setEditId(null) : openEdit(league))}
    >
      {editId === league.id ? 'Cancel' : 'Edit'}
    </button>
  </div>
</div>;

{
  editId === league.id && (
    <div className="mt-4 grid gap-3 border-t border-gray-100 pt-4">
      <input
        className="border rounded px-3 py-2 text-sm"
        placeholder="Name"
        value={editForm.name}
        onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
      />
      <textarea
        className="border rounded px-3 py-2 text-sm"
        placeholder="Description (optional)"
        rows={2}
        value={editForm.description}
        onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
      />
      <div className="flex flex-wrap gap-4 items-center">
        <select
          className="border rounded px-3 py-2 text-sm"
          value={editForm.status}
          onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
        >
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={editForm.publicVisibility}
            onChange={(e) => setEditForm((f) => ({ ...f, publicVisibility: e.target.checked }))}
          />
          Public
        </label>
        <button className="bg-gray-950 text-white rounded px-3 py-2 text-sm" onClick={saveEdit}>
          Save
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
pnpm --filter web-admin tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Manual smoke test — edit**

Open a league card, click Edit. Confirm the form pre-fills with current values. Change the name, click Save. Confirm the card updates without a page reload.

- [ ] **Step 6: Commit**

```bash
git add apps/web-admin/app/admin/leagues/page.tsx
git commit -m "feat: inline league edit panel (name, description, status, visibility)"
```

---

## Task 7: Frontend — Delete League

**Files:**

- Modify: `apps/web-admin/app/admin/leagues/page.tsx`

- [ ] **Step 1: Add `deleteLeague` helper**

Inside `AdminLeaguesPage`, add after `saveEdit`:

```ts
const deleteLeague = (leagueId: string, name: string) => {
  if (!window.confirm(`Delete league "${name}"? This cannot be undone.`)) return;
  fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
    .then((res) => {
      if (!res.ok) throw new Error('Delete failed');
      load();
    })
    .catch(() => setError('Failed to delete league'));
};
```

- [ ] **Step 2: Add Delete button to the card action buttons**

Inside the action buttons `<div>`, add after the Edit button:

```tsx
<button
  className="text-sm underline text-red-600"
  onClick={() => deleteLeague(league.id, league.name)}
>
  Delete
</button>
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter web-admin tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Manual smoke test — delete**

Click Delete on a test league, cancel the confirm dialog — nothing should happen. Click Delete again, confirm — card disappears.

- [ ] **Step 5: Commit**

```bash
git add apps/web-admin/app/admin/leagues/page.tsx
git commit -m "feat: delete league with confirmation"
```

---

## Task 8: Frontend — Scoring Config Editor

**Files:**

- Modify: `apps/web-admin/app/admin/leagues/page.tsx`

The scoring editor lives inside the edit panel (Task 6). The edit save is extended to include `scoringConfig`.

- [ ] **Step 1: Extend `editForm` state to include scoring fields**

Update the `editForm` state type and initial value (the `useState` call added in Task 6):

```ts
const [editForm, setEditForm] = useState<{
  name: string;
  description: string;
  status: string;
  publicVisibility: boolean;
  scoringSystem: 'ffamhe_tf_2026' | 'custom';
  pointRows: Array<{ rank: number; points: number }>;
}>({
  name: '',
  description: '',
  status: 'draft',
  publicVisibility: false,
  scoringSystem: 'ffamhe_tf_2026',
  pointRows: [],
});
```

- [ ] **Step 2: Update `openEdit` to populate scoring fields from the league**

Replace the `openEdit` function:

```ts
const openEdit = (league: League) => {
  setEditId(league.id);
  const cfg = league.scoring_config;
  const isCustom = cfg?.scoringSystem === 'custom';
  setEditForm({
    name: league.name,
    description: league.description ?? '',
    status: league.status,
    publicVisibility: league.public_visibility,
    scoringSystem: isCustom ? 'custom' : 'ffamhe_tf_2026',
    pointRows:
      isCustom && cfg?.customPointsByRank
        ? Object.entries(cfg.customPointsByRank)
            .map(([rank, points]) => ({ rank: Number(rank), points: Number(points) }))
            .sort((a, b) => a.rank - b.rank)
        : [],
  });
};
```

- [ ] **Step 3: Update `saveEdit` to include `scoringConfig`**

Replace the `saveEdit` function:

```ts
const saveEdit = () => {
  if (!editId) return;
  const existingLeague = leagues.find((l) => l.id === editId);
  const existingCfg = existingLeague?.scoring_config;

  const scoringConfig =
    editForm.scoringSystem === 'custom'
      ? {
          scoringSystem: 'custom' as const,
          rankingDimensions: existingCfg?.rankingDimensions ?? 'weapon',
          tieBreakers: existingCfg?.tieBreakers ?? [
            'total_points',
            'participation_count',
            'medal_count',
            'double_hit_average',
          ],
          customPointsByRank: Object.fromEntries(editForm.pointRows.map((r) => [r.rank, r.points])),
        }
      : {
          scoringSystem: 'ffamhe_tf_2026' as const,
          rankingDimensions: existingCfg?.rankingDimensions ?? 'weapon',
          tieBreakers: existingCfg?.tieBreakers ?? [
            'total_points',
            'participation_count',
            'medal_count',
            'double_hit_average',
          ],
        };

  fetch(`${apiUrl}/api/v1/admin/leagues/${editId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: editForm.name,
      description: editForm.description || undefined,
      status: editForm.status,
      publicVisibility: editForm.publicVisibility,
      scoringConfig,
    }),
  })
    .then((res) => {
      if (!res.ok) throw new Error('Update failed');
      setEditId(null);
      load();
    })
    .catch(() => setError('Failed to update league'));
};
```

- [ ] **Step 4: Add the scoring config JSX section inside the edit panel**

Inside the edit panel JSX (the `{editId === league.id && ...}` block), add the scoring section after the existing status/visibility row:

```tsx
<div className="border-t border-gray-100 pt-3">
  <p className="text-xs font-semibold text-gray-500 mb-2">Scoring System</p>
  <div className="flex gap-4 mb-3">
    <label className="flex items-center gap-2 text-sm">
      <input
        type="radio"
        checked={editForm.scoringSystem === 'ffamhe_tf_2026'}
        onChange={() =>
          setEditForm((f) => ({ ...f, scoringSystem: 'ffamhe_tf_2026', pointRows: [] }))
        }
      />
      FFAMHE TF 2026 (preset)
    </label>
    <label className="flex items-center gap-2 text-sm">
      <input
        type="radio"
        checked={editForm.scoringSystem === 'custom'}
        onChange={() =>
          setEditForm((f) => ({
            ...f,
            scoringSystem: 'custom',
            pointRows:
              f.pointRows.length > 0
                ? f.pointRows
                : Object.entries(FFAMHE_POINTS).map(([rank, points]) => ({
                    rank: Number(rank),
                    points: Number(points),
                  })),
          }))
        }
      />
      Custom
    </label>
  </div>

  {editForm.scoringSystem === 'custom' && (
    <div>
      <table className="text-sm w-full max-w-xs mb-2">
        <thead>
          <tr>
            <th className="text-left px-2 py-1 text-xs text-gray-500">Rank</th>
            <th className="text-left px-2 py-1 text-xs text-gray-500">Points</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {editForm.pointRows.map((row, i) => (
            <tr key={i}>
              <td className="px-2 py-1">
                <input
                  type="number"
                  min={1}
                  className="border rounded px-2 py-1 w-16 text-sm"
                  value={row.rank}
                  onChange={(e) => {
                    const updated = [...editForm.pointRows];
                    updated[i] = { ...updated[i], rank: Number(e.target.value) };
                    setEditForm((f) => ({ ...f, pointRows: updated }));
                  }}
                />
              </td>
              <td className="px-2 py-1">
                <input
                  type="number"
                  min={0}
                  className="border rounded px-2 py-1 w-16 text-sm"
                  value={row.points}
                  onChange={(e) => {
                    const updated = [...editForm.pointRows];
                    updated[i] = { ...updated[i], points: Number(e.target.value) };
                    setEditForm((f) => ({ ...f, pointRows: updated }));
                  }}
                />
              </td>
              <td className="px-2 py-1">
                <button
                  className="text-red-500 text-xs underline"
                  onClick={() =>
                    setEditForm((f) => ({
                      ...f,
                      pointRows: f.pointRows.filter((_, j) => j !== i),
                    }))
                  }
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="text-sm underline"
        onClick={() =>
          setEditForm((f) => ({
            ...f,
            pointRows: [...f.pointRows, { rank: f.pointRows.length + 1, points: 0 }],
          }))
        }
      >
        + Add row
      </button>
    </div>
  )}
</div>
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
pnpm --filter web-admin tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Manual smoke test — scoring config**

Open a league in edit mode. Confirm the system selector shows "FFAMHE TF 2026 (preset)". Switch to Custom — confirm the table pre-fills with ranks 1–16. Change rank 1 to 20 points. Save. Recompute the league. Verify rank-1 fighters now show 20 points in standings.

- [ ] **Step 7: Commit**

```bash
git add apps/web-admin/app/admin/leagues/page.tsx
git commit -m "feat: scoring config editor with preset and custom points-by-rank"
```

---

## Task 9: Frontend — Remove Tournament Links (Individual + Bulk by Event)

**Files:**

- Modify: `apps/web-admin/app/admin/leagues/page.tsx`

- [ ] **Step 1: Add `removeLink` and `removeEventLinks` helpers**

Inside `AdminLeaguesPage`, add after `deleteLeague`:

```ts
const removeLink = (linkId: string, leagueId: string) => {
  fetch(`${apiUrl}/api/v1/admin/league-tournament-links/${linkId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'removed' }),
  })
    .then((res) => {
      if (!res.ok) throw new Error('Remove failed');
      return fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/tournament-links`, {
        credentials: 'include',
      });
    })
    .then((res) => (res.ok ? (res.json() as Promise<TournamentLink[]>) : []))
    .then((updated) => setLinks((prev) => ({ ...prev, [leagueId]: updated })))
    .catch(() => setError('Failed to remove link'));
};

const removeEventLinks = (leagueId: string, eventId: string) => {
  fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/events/${eventId}/tournament-links`, {
    method: 'DELETE',
    credentials: 'include',
  })
    .then((res) => {
      if (!res.ok) throw new Error('Bulk remove failed');
      return fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/tournament-links`, {
        credentials: 'include',
      });
    })
    .then((res) => (res.ok ? (res.json() as Promise<TournamentLink[]>) : []))
    .then((updated) => setLinks((prev) => ({ ...prev, [leagueId]: updated })))
    .catch(() => setError('Failed to remove event links'));
};
```

- [ ] **Step 2: Replace the tournament links JSX section**

Find the existing `<h3>` "requests" section inside the league card and replace it entirely with:

```tsx
{
  /* Group links by event */
}
{
  (() => {
    const leagueLinks = links[league.id] ?? [];
    const byEvent = new Map<
      string,
      { eventId: string; eventName: string; links: TournamentLink[] }
    >();
    for (const link of leagueLinks) {
      const eventId = link.tournaments?.events?.id ?? '__no_event__';
      const eventName = link.tournaments?.events?.name ?? 'Unknown event';
      if (!byEvent.has(eventId)) byEvent.set(eventId, { eventId, eventName, links: [] });
      byEvent.get(eventId)!.links.push(link);
    }

    if (byEvent.size === 0) return null;

    return (
      <>
        <h3 className="text-sm font-semibold mt-5 mb-2">{t('admin.leagues.requests')}</h3>
        {[...byEvent.values()].map((group) => (
          <div key={group.eventId} className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-600">{group.eventName}</span>
              {group.eventId !== '__no_event__' && (
                <button
                  className="text-xs underline text-red-600"
                  onClick={() => removeEventLinks(league.id, group.eventId)}
                >
                  Remove all
                </button>
              )}
            </div>
            <div className="grid gap-2">
              {group.links.map((link) => (
                <div
                  key={link.id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded border p-3 text-sm ${
                    link.status === 'removed' ? 'border-gray-100 opacity-40' : 'border-gray-200'
                  }`}
                >
                  <span>
                    {link.tournaments?.name}{' '}
                    {link.tournaments?.weapon && `· ${link.tournaments.weapon}`}{' '}
                    {link.tournaments?.category && `· ${link.tournaments.category}`}
                  </span>
                  <span className="text-gray-500 capitalize">{link.status}</span>
                  <span className="flex gap-2">
                    {link.status === 'requested' && (
                      <>
                        <button className="underline" onClick={() => review(link.id, 'approved')}>
                          {t('admin.leagues.approve')}
                        </button>
                        <button className="underline" onClick={() => review(link.id, 'rejected')}>
                          {t('admin.leagues.reject')}
                        </button>
                      </>
                    )}
                    {link.status !== 'removed' && (
                      <button
                        className="underline text-red-600"
                        onClick={() => removeLink(link.id, league.id)}
                      >
                        Remove
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </>
    );
  })();
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter web-admin tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Manual smoke test — remove links**

Click Remove on an approved link — confirm it greys out. Click "Remove all" on an event group — confirm all links in that group grey out.

- [ ] **Step 5: Commit**

```bash
git add apps/web-admin/app/admin/leagues/page.tsx
git commit -m "feat: remove individual and bulk event tournament links"
```

---

## Task 10: Frontend — Fuzzy Add Tournaments Panel

**Files:**

- Modify: `apps/web-admin/app/admin/leagues/page.tsx`

- [ ] **Step 1: Add Event and Tournament interfaces**

After the `TournamentLink` interface, add:

```ts
interface EventSummary {
  id: string;
  name: string;
  slug: string;
  start_date: string | null;
}

interface TournamentSummary {
  id: string;
  name: string | null;
  weapon: string | null;
  category: string | null;
}
```

- [ ] **Step 2: Add state for the add panel**

Inside `AdminLeaguesPage`, add after `editForm` state:

```ts
const [addPanelLeagueId, setAddPanelLeagueId] = useState<string | null>(null);
const [allEvents, setAllEvents] = useState<EventSummary[]>([]);
const [eventSearch, setEventSearch] = useState('');
const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
const [eventTournaments, setEventTournaments] = useState<Record<string, TournamentSummary[]>>({});
```

- [ ] **Step 3: Add `openAddPanel`, `expandEvent`, `addTournament`, `addEventTournaments` helpers**

Inside `AdminLeaguesPage`, add after `removeEventLinks`:

```ts
const openAddPanel = (leagueId: string) => {
  if (addPanelLeagueId === leagueId) {
    setAddPanelLeagueId(null);
    return;
  }
  setAddPanelLeagueId(leagueId);
  setEventSearch('');
  setExpandedEventId(null);
  if (allEvents.length === 0) {
    fetch(`${apiUrl}/api/v1/events`, { credentials: 'include' })
      .then((res) => (res.ok ? (res.json() as Promise<EventSummary[]>) : []))
      .then(setAllEvents)
      .catch(() => setError('Failed to load events'));
  }
};

const expandEvent = (eventId: string) => {
  if (expandedEventId === eventId) {
    setExpandedEventId(null);
    return;
  }
  setExpandedEventId(eventId);
  if (!eventTournaments[eventId]) {
    fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, { credentials: 'include' })
      .then((res) => (res.ok ? (res.json() as Promise<TournamentSummary[]>) : []))
      .then((ts) => setEventTournaments((prev) => ({ ...prev, [eventId]: ts })))
      .catch(() => setError('Failed to load tournaments'));
  }
};

const addTournament = (leagueId: string, tournamentId: string) => {
  fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/tournaments/${tournamentId}/link`, {
    method: 'POST',
    credentials: 'include',
  })
    .then((res) => {
      if (!res.ok) throw new Error('Add failed');
      return fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/tournament-links`, {
        credentials: 'include',
      });
    })
    .then((res) => (res.ok ? (res.json() as Promise<TournamentLink[]>) : []))
    .then((updated) => setLinks((prev) => ({ ...prev, [leagueId]: updated })))
    .catch(() => setError('Failed to add tournament'));
};

const addEventTournaments = (leagueId: string, eventId: string) => {
  fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/events/${eventId}/link`, {
    method: 'POST',
    credentials: 'include',
  })
    .then((res) => {
      if (!res.ok) throw new Error('Add failed');
      return fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/tournament-links`, {
        credentials: 'include',
      });
    })
    .then((res) => (res.ok ? (res.json() as Promise<TournamentLink[]>) : []))
    .then((updated) => setLinks((prev) => ({ ...prev, [leagueId]: updated })))
    .catch(() => setError('Failed to add event tournaments'));
};
```

- [ ] **Step 4: Add the "Add tournaments" button to each card's action buttons**

Inside the action buttons `<div>`, add after the Delete button:

```tsx
<button className="text-sm underline" onClick={() => openAddPanel(league.id)}>
  {addPanelLeagueId === league.id ? 'Close add panel' : 'Add tournaments'}
</button>
```

- [ ] **Step 5: Add the add panel JSX below the links section**

After the closing tag of the tournament links IIFE block, add:

```tsx
{
  addPanelLeagueId === league.id && (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <p className="text-sm font-semibold mb-2">Add tournaments</p>
      <input
        className="border rounded px-3 py-2 text-sm w-full max-w-sm mb-3"
        placeholder="Search events…"
        value={eventSearch}
        onChange={(e) => setEventSearch(e.target.value)}
      />
      <div className="grid gap-2 max-h-72 overflow-y-auto">
        {allEvents
          .filter((ev) => !eventSearch || fuzzyMatch(eventSearch, ev.name))
          .map((ev) => {
            const linked = new Set(
              (links[league.id] ?? [])
                .filter((l) => l.status !== 'removed')
                .map((l) => l.tournaments?.id)
                .filter(Boolean),
            );
            return (
              <div key={ev.id} className="border border-gray-100 rounded p-2">
                <div className="flex items-center justify-between gap-2">
                  <button className="text-sm text-left flex-1" onClick={() => expandEvent(ev.id)}>
                    {expandedEventId === ev.id ? '▾' : '▸'} {ev.name}
                  </button>
                  <button
                    className="text-xs underline"
                    onClick={() => addEventTournaments(league.id, ev.id)}
                  >
                    Add all
                  </button>
                </div>
                {expandedEventId === ev.id && (
                  <div className="mt-2 grid gap-1 pl-4">
                    {(eventTournaments[ev.id] ?? []).map((tour) => {
                      const isLinked = linked.has(tour.id);
                      return (
                        <div
                          key={tour.id}
                          className={`flex items-center justify-between text-sm ${
                            isLinked ? 'opacity-40' : ''
                          }`}
                        >
                          <span>
                            {tour.name}
                            {tour.weapon ? ` · ${tour.weapon}` : ''}
                            {tour.category ? ` · ${tour.category}` : ''}
                          </span>
                          <button
                            className="text-xs underline"
                            disabled={isLinked}
                            onClick={() => !isLinked && addTournament(league.id, tour.id)}
                          >
                            {isLinked ? 'Linked' : 'Add'}
                          </button>
                        </div>
                      );
                    })}
                    {eventTournaments[ev.id]?.length === 0 && (
                      <p className="text-xs text-gray-400">No tournaments</p>
                    )}
                    {!eventTournaments[ev.id] && <p className="text-xs text-gray-400">Loading…</p>}
                  </div>
                )}
              </div>
            );
          })}
        {allEvents.filter((ev) => !eventSearch || fuzzyMatch(eventSearch, ev.name)).length ===
          0 && <p className="text-sm text-gray-400">No events match "{eventSearch}"</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
pnpm --filter web-admin tsc --noEmit
```

Expected: no errors

- [ ] **Step 7: Manual smoke test — fuzzy add**

Click "Add tournaments" on a league. Type partial event name with wrong case or accents. Confirm results filter correctly. Expand an event, click Add on one tournament — confirm it appears in the links section as approved and button becomes "Linked". Click "Add all" on another event — confirm all its tournaments appear.

- [ ] **Step 8: Final commit**

```bash
git add apps/web-admin/app/admin/leagues/page.tsx
git commit -m "feat: fuzzy event/tournament search for admin-initiated league links"
```

---

## Verification Checklist

- [ ] `pnpm --filter web-admin test` — all league-utils tests pass
- [ ] `pnpm --filter api tsc --noEmit` — no TypeScript errors in API
- [ ] `pnpm --filter web-admin tsc --noEmit` — no TypeScript errors in admin app
- [ ] Slug auto-fills from name; manual edit detaches; resets after create
- [ ] Edit panel saves name/description/status/visibility changes
- [ ] Delete with confirm removes the league
- [ ] Scoring: switch to Custom pre-fills ffamhe_tf_2026 table; save + recompute reflects custom points
- [ ] Individual Remove greyed out links; Bulk "Remove all" removes the entire event group
- [ ] Fuzzy search filters events; Add one tournament; Add all event; already-linked tournaments show as disabled
