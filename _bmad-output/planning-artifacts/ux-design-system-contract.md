# MyClash Public App — UX Design-System Contract (Phase 0)

_Owner: Sally (UX). Status: ratified by Tony, 2026-06-27. Scope: `apps/web-public` + `packages/{design-tokens,ui}`. Goal: the public app reads as **one website** while keeping an **intentional light/dark split**._

This is the contract the implementation passes follow. Decisions here are binding; deviations need a new decision.

---

## 1. Two surfaces, one semantic token set

There are exactly **two visual surfaces**, both driven by the **same semantic tokens** — components never hardcode a palette value or hex.

- **Light surface** — landing, all `/e/*` event/tournament pages, `/leagues`, `/fighters`, `/clubs`, profiles. Accent = **brand red**.
- **Dark surface** — `/me/*` personal space, `/login`, `/reset-password`, OAuth callback. Accent = **blue** (personal space keeps its identity — intentional).

### Semantic tokens (shadcn-style names; no `text-text`)

Defined once in `apps/web-public/src/styles/globals.css` via Tailwind v4 `@theme` (light defaults), remapped under a `[data-theme="dark"]` scope. Values reference the existing palette in `packages/design-tokens/src/tokens.ts`.

| Token (utility)                        | Light               | Dark                | Role                    |
| -------------------------------------- | ------------------- | ------------------- | ----------------------- |
| `background` (`bg-background`)         | stone-50 `#fafaf9`  | slate-900 `#0f172a` | page surface            |
| `surface` (`bg-surface`)               | white `#ffffff`     | slate-800 `#1e293b` | cards / raised          |
| `foreground` (`text-foreground`)       | slate-900 `#0f172a` | slate-100 `#f1f5f9` | primary text            |
| `muted` (`text-muted`)                 | slate-500 `#64748b` | slate-400 `#94a3b8` | secondary text          |
| `border` (`border-border`)             | stone-200 `#e7e5e4` | slate-700 `#334155` | hairlines               |
| `accent` (`bg-accent` / `text-accent`) | red-700 `#b91c1c`   | blue-700 `#1d4ed8`  | primary action / active |
| `accent-hover`                         | red-800 `#991b1b`   | blue-600 `#2563eb`  | hover of accent         |
| `accent-foreground`                    | white               | white               | text on accent          |

**Status tokens** (fixed semantics, same intent both themes; dark uses the −100 lighter step for contrast): `danger` red-600/500, `success` green-600/500, `warning` gold-600/500, `info` blue-600/400. Use for badges/alerts only — not as page accent.

### Mechanism (Tailwind v4)

- `@theme { --color-background: …; … }` in `globals.css` = light defaults (emitted to `:root`).
- `[data-theme="dark"] { --color-background: …; … }` overrides the same vars. `PublicPersonalShell` and the auth pages set `data-theme="dark"` on their root wrapper; everything inside adapts automatically.
- **Event color = accent override on the light base only:** on `/e/*`, set `--color-accent: var(--event-primary, #b91c1c)` (+ a matching hover). Event color tints the accent; it is **not** a third surface.
- **Hard rule:** no raw hex in `apps/web-public/app` or `src` (except the token definitions in `globals.css` / `design-tokens`). Enforced by grep in verification.

---

## 2. Type scale (use `font-display` on BOTH themes)

| Level           | Classes                                                         | Use                   |
| --------------- | --------------------------------------------------------------- | --------------------- |
| Page title (H1) | `font-display font-bold text-2xl sm:text-3xl text-foreground`   | one per page          |
| Section (H2)    | `font-display font-semibold text-lg sm:text-xl text-foreground` | section headers       |
| Subsection (H3) | `font-semibold text-base text-foreground`                       | inside sections       |
| Eyebrow / label | `text-xs font-semibold uppercase tracking-wider text-muted`     | kickers, field labels |
| Body            | `text-sm text-foreground` (secondary: `text-muted`)             | content               |

Fixes today's drift: `font-semibold`↔`font-bold` mixing, `text-2xl`↔`text-3xl` at `sm`, and the display font being dropped on dark pages (`/leagues`, `/me`).

---

## 3. Container-width scale (pick exactly one)

| Width       | When                                                               |
| ----------- | ------------------------------------------------------------------ |
| `max-w-7xl` | landing / marketing hero + grids                                   |
| `max-w-6xl` | **default content** — event, tournament, listings, `/me` content   |
| `max-w-2xl` | forms, single-column reading, detail (login card, workshop detail) |

Standard padding + centering: `mx-auto px-4 py-6 sm:px-6 lg:px-8`. **Fix:** the workshops catalog moves `max-w-2xl → max-w-6xl`.

---

## 4. Component standards (adopt the shared library)

Stop hand-rolling; use `@myclash/ui` + `src/components`, all token-based so one component serves both themes.

- **`Button`** — rename variant **`next` → `primary`**; consolidated set: `primary` (accent-filled), `secondary`, `ghost`, `danger`, `link`. Keep `next` as a temporary deprecated alias during migration, then delete. Adopt across event + personal pages (replace inline button styles).
- **`Card`** — make token-based (`bg-surface border-border`) so it works light **and** dark (today it's dark-only). `TournamentCard` / `WorkshopCard` refactor onto it.
- **`Pill` / `Badge`** — one status-variant set mapped to the status tokens.
- **`EmptyState`** — token-based; adopt for **every** zero-state (replace inline `<p>` empties, e.g. tournament list, leagues).
- **`BackLink`** (`src/components/BackLink.tsx`) — token-based; present on every non-hub page (see §5).

---

## 5. Chrome + back-navigation contract

| Surface                                                      | Chrome                                    | Theme                      |
| ------------------------------------------------------------ | ----------------------------------------- | -------------------------- |
| Landing, `/e/*`, `/leagues`, `/fighters`, `/clubs`, profiles | `SiteHeader`                              | light                      |
| `/me/*`                                                      | `PublicPersonalShell` (sidebar)           | dark (`data-theme="dark"`) |
| `/login`, `/reset-password`, OAuth callback                  | standalone centered card, no header/shell | dark                       |
| `/e/*/match/*/display`                                       | chromeless (kiosk — intentional)          | —                          |

- **`EventHeader`** identity band stays, rendered under `SiteHeader` on event pages.
- **Back affordance:** `BackLink` on every page that is **not** a top-level hub — **including `/me/*` sub-pages** (today they have none → mobile drawer trap). Hubs that don't need one: landing, the `/me` dashboard, the event home.

---

## 6. Out of scope (flagged follow-ups, not part of this visual contract)

- `/profile/fighter|referee` (signed-out) vs `/me/fighter|referee` (signed-in) — mental-model/URL consolidation. Routing decision, separate task.
- Promote this contract to `docs/` once stable (currently a planning artifact).

---

## 7. Verification (per implementation pass)

- `pnpm --filter @myclash/web-public exec tsc --noEmit` + `eslint` on touched files; `pnpm --filter @myclash/i18n test` (EN+FR) green.
- `grep -rE '#[0-9a-fA-F]{6}' apps/web-public/app apps/web-public/src` → matches only in `globals.css` token defs.
- Visual pass per page group: light pages share the light token set, `/me` + login share the dark set, headings/containers consistent, shared components in use, `/me` sub-pages have a back link.
