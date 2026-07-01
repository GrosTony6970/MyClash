# Unified Participants Page — Design Spec

_2026-05-18_

## Context

The organiser event hub currently has two separate sections — **Persons & Roster** (`/persons`) and **Registrations** (`/registrations`) — that manage overlapping data about the same people. Organisers must navigate between them to do basic tasks like adding a new competitor and registering them in a tournament. This spec merges both sections into a single **Participants** page with a unified add-participant flow, global profile search, contextual bulk actions, and tournament-tab filtering.

---

## Scope

Changes to:

1. `apps/web-admin/app/org/[slug]/events/[eventId]/persons/page.tsx` — full rewrite as unified Participants page
2. `apps/web-admin/app/org/[slug]/events/[eventId]/registrations/page.tsx` — replaced with redirect to `../persons`
3. `apps/web-admin/src/components/OrganizerAdminShell.tsx` — rename nav item, remove Registrations item
4. `apps/web-admin/app/org/[slug]/events/[eventId]/page.tsx` — rename section card, remove Registrations card
5. `packages/i18n/src/index.ts` — update translation keys

No new backend endpoints. All required APIs already exist.

---

## 1. Navigation & Routing

**Route:** `/org/:slug/events/:eventId/persons` — unchanged URL, full page rewrite.

**`/registrations`:** `registrations/page.tsx` becomes a Next.js redirect page using `useRouter().replace('../persons')` on mount, so any existing bookmarks redirect transparently.

**`OrganizerAdminShell.tsx`:**

- Rename: `labelKey: 'organizer.eventHub.sections.persons'` → badge stays `'P'`
- Remove: `{ href: 'registrations', ... }` nav item

**Event hub `page.tsx`:**

- Rename persons section label
- Remove registrations section from the `sections` array

**i18n (`packages/i18n/src/index.ts`):**

| Key                                         | EN (before)        | EN (after)     |
| ------------------------------------------- | ------------------ | -------------- |
| `organizer.eventHub.sections.persons`       | `Persons & Roster` | `Participants` |
| `organizer.eventHub.sections.registrations` | `Registrations`    | _(removed)_    |

French equivalents updated the same way (`Participants` stays as `Participants`).

---

## 2. Page Layout

```
[Search by name…          ]   [+ Add participant]  [CSV import →]

[All event] [Longsword Open] [Messer] [Rapier Mixed]

☐  Name          Club        Claim status    Tournaments          Actions
☐  Jean Dupont   Lyon AMHE   claimed         LS Open (checked_in) Edit · Delete
                                             Messer (registered)
☐  Marie Martin  —           unclaimed       —                    Edit · Delete
```

- **Search bar** — client-side filter on the fetched persons list, applies within the active tab.
- **Tournament tabs** — generated dynamically from the event's tournament list. "All event" is always first and is the default.
- **Table** — one row per person. Tournament pills shown inline in the Tournaments column.
- **Checkbox column** — enables bulk actions. Select-all checkbox in header.

---

## 3. Tournament Tabs

| Tab                     | Table shows                             | Tournaments column                                                                                         |
| ----------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **All event** (default) | All persons in the event roster         | One pill per tournament the person is registered in, each pill shows that tournament's registration status |
| **[Tournament X]**      | Only persons registered in tournament X | Single status badge for tournament X                                                                       |

When switching tabs, the search query is preserved.

---

## 4. Bulk Actions

The bulk action bar appears above the table when ≥1 row is checked. Available actions depend on the active tab.

### On "All event" tab

| Action                   | Behaviour                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **Delete selected**      | `DELETE /api/v1/persons/:id` for each selected person (removes person + all their registrations)                                |
| **Assign to tournament** | Opens a tournament picker dropdown; on confirm: `POST /api/v1/tournaments/:tournamentId/registrations` for each selected person |

### On a tournament tab [X]

| Action                           | Behaviour                                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Check in selected**            | `PATCH /api/v1/registrations/:id/status` `{ status: 'checked_in' }` for each selected person's registration in X |
| **Unassign from [X]**            | `DELETE /api/v1/registrations/:id` for each selected person's registration in X; person stays in roster          |
| **Assign to another tournament** | Tournament picker (excludes X); creates registrations in chosen tournament                                       |
| **Delete selected**              | `DELETE /api/v1/persons/:id` for each (removes from event entirely)                                              |

All bulk operations run sequentially with a loading state. Errors are shown inline without aborting remaining items.

---

## 5. Add Participant Modal

### 5a. Global profile search (top of modal)

Search field: `"Search global profiles by name"`

- Debounced 250 ms, queries `GET /api/v1/global-persons?q=<term>`
- Results list shows: full name, club, HEMA Ratings ID
- Clicking a result pre-fills all matching form fields below and stores `globalPersonId` for the create call
- Clearing the search field resets pre-fill and `globalPersonId`
- Results hidden if the field is empty or fewer than 2 characters

### 5b. Form fields

| Field           | Required | Notes                                                                                                                                       |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Given name      | Yes      |                                                                                                                                             |
| Family name     | Yes      |                                                                                                                                             |
| Email           | No       |                                                                                                                                             |
| Club            | No       | Fuzzy-search against `GET /api/v1/clubs?q=<term>&searchAbv=true`; shows name + abbreviation in results; stores `clubId` (UUID) on selection |
| HEMA Ratings ID | No       | Uses existing `HemaRatingsSuggest` component                                                                                                |
| Seed            | No       | Integer ≥ 1                                                                                                                                 |
| Bib number      | —        | **Removed**                                                                                                                                 |

**Club search behaviour:** input is debounced 250 ms. Results show club name and abbreviation. Selecting a club stores its UUID; the save call sends `clubId` (not `clubName`). The field can be cleared to deselect.

### 5c. Tournament selection

Below the form: `"Register in tournaments (optional)"`

- Checkbox list of all tournaments for this event
- None checked = add person to roster without any registration
- One or more checked = person created then registered in each checked tournament

### 5d. Save flow

1. `POST /api/v1/events/:eventId/persons` — body: `{ givenName, familyName, email?, clubName?, hemaRatingsId?, globalPersonId? }`
2. For each checked tournament: `POST /api/v1/tournaments/:tournamentId/registrations` — body: `{ personId, seed?, hemaRatingsId? }`
3. On success: close modal, refresh data.
4. On error: show error message, keep modal open.

---

## 6. Edit Person Modal

Opens via the **Edit** action button in the table row. Pre-fills existing person data.

Fields: given name, family name, email, club, HEMA Ratings ID (no seed, no tournament changes).

Calls `PATCH /api/v1/persons/:id`.

Tournament registrations are managed via bulk actions on the table, not in the edit modal.

---

## 7. Data Fetching

On page load, three parallel fetches:

```ts
GET /api/v1/events/:eventId/persons
GET /api/v1/events/:eventId/registrations
GET /api/v1/events/:eventId/tournaments
```

Client builds: `registrationsByPersonId: Map<string, Registration[]>` from the registrations response.

Tournament tabs and tournament checkboxes in the add modal both derive from the tournaments list.

When the active tab is a specific tournament, the displayed rows are filtered to persons who have at least one registration with `tournamentId === activeTournamentId`.

---

## 8. CSV Import

Unchanged. The existing import wizard at `/persons/import` is preserved. The "CSV import" button in the top-right links there.

---

## Files Modified

| File                                                                    | Change                                                     |
| ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| `apps/web-admin/app/org/[slug]/events/[eventId]/persons/page.tsx`       | Full rewrite — unified Participants page                   |
| `apps/web-admin/app/org/[slug]/events/[eventId]/registrations/page.tsx` | Replace with redirect to `../persons`                      |
| `apps/web-admin/src/components/OrganizerAdminShell.tsx`                 | Rename persons item, remove registrations item             |
| `apps/web-admin/app/org/[slug]/events/[eventId]/page.tsx`               | Rename persons card, remove registrations card             |
| `packages/i18n/src/index.ts`                                            | Update `sections.persons`, remove `sections.registrations` |
| `apps/api/src/modules/persons/dto/persons.dto.ts`                       | Add `globalPersonId?: string` to `CreatePersonDto`         |
| `apps/api/src/modules/persons/persons.service.ts`                       | Pass `globalPersonId` through to person insert             |

One minor backend change: `globalPersonId` optional UUID added to `CreatePersonDto`. No new endpoints. No DB migrations.

---

## Verification

1. Navigate to `/org/:slug/events/:eventId/persons` — see unified Participants page with "All event" tab active.
2. Navigate to `/org/:slug/events/:eventId/registrations` — redirected to `/persons`.
3. Sidebar nav shows "Participants" only; no "Registrations" item.
4. Click a tournament tab — table filters to only persons registered in that tournament.
5. Search bar filters within the active tab.
6. Open "Add participant" modal — type a name, see global profile suggestions, click one → form pre-fills.
7. Fill form manually (no global profile selected), check two tournaments, save — person appears in table with two tournament pills.
8. Select multiple rows on "All event" tab — bulk actions "Delete" and "Assign to tournament" appear.
9. Switch to a tournament tab, select rows — "Check in", "Unassign", "Assign to another", "Delete" appear.
10. CSV import link still works; import wizard unchanged.
