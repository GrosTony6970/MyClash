# web-admin — surface delta

> Delta against [`/DESIGN.md`](../../DESIGN.md). Only what this surface changes. The language, tokens and rules come from the root file — read it first.

`admin.myclash.fr` · port 3003 · Next.js App Router · auth-gated except the sign-in pages (`export const dynamic = 'force-dynamic'`)

## The reference, shifted

The root reference is the tournament programme. Admin is **the organizer's desk behind the check-in table** — the same booklet, but the copy that gets written _in_. Ledgers, entry lists, the timetable being pencilled. It is the only surface where the user is producing the booklet rather than reading it.

That makes admin the **densest** surface in the system, and the one where the "labels quiet, values loud" rule does the most work: an organizer scanning 200 registrations needs the names to be the only thing they see.

## Device & density

Desktop-first, and unapologetically so. A fixed `w-72` sidebar from `lg:` up; below that it collapses to a `w-80 max-w-[85vw]` drawer. Tables over cards. This is someone at a laptop for two hours, not a phone.

## Scopes

| Region                                                                            | Scope               | Result                              |
| --------------------------------------------------------------------------------- | ------------------- | ----------------------------------- |
| Page content                                                                      | _(none — base)_     | Light surface, **red** accent       |
| Sidebar rail + mobile drawer                                                      | `data-theme="dark"` | Dark chrome framing a light page    |
| `/login`, `/signup`, `/reset-password`, `/auth/choose-password` (the `AuthPanel`) | `data-theme="dark"` | Dark panel, **red** accent — public |

Admin never sets `data-accent`. **The accent here is always red** — blue is the personal space's identity, not a theme. The sign-in pages are the same `AuthPanel` the public app uses, without its `accent="personal"`: dark and red here, dark and blue there.

## Four shells, mutually exclusive on purpose

| Route                                           | Shell                                             | Note                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/admin/*` (45 page files, 4 of them redirects) | `SuperAdminShell`                                 | 6-section sidebar: Overview / Content / Operations / Platform health / AI / Settings                             |
| `/org/[slug]/*` (56 page files)                 | `OrganizerAdminShell` + `organizer-event-context` |                                                                                                                  |
| `/leagues/*`                                    | `LeagueWorkspaceShell`                            | Deliberately outside the other two: a league can be run by an account that is neither super-admin nor org member |
| `/display/[matchId]`, `/display/wall/[eventId]` | _none_                                            | Chromeless projector stage — see [`display-kiosk.md`](display-kiosk.md)                                          |

The `/leagues` and `/display` layouts carry comments saying they sit outside the others intentionally. They do. Don't "unify" them.

`/dashboard` belongs to none of the four. It is where a sign-in lands: it resolves the account's workspace and redirects, and shows a chooser only to an account that has both.

**One cross-workspace affordance, not three.** `WorkspaceSwitcher` is the gold line directly under the logo in both sidebar shells, mounted as the first child of the shared `sidebar` node so the mobile drawer gets it too. It names the workspace you are in — "Platform Admin workspace" / "Organiser workspace" — and grows a `switchWorkspace` icon plus a popover only when the account can reach somewhere else. The platform tier lives on that popover's platform row; it is not a badge under the wordmark any more. Don't reintroduce a per-shell switch link.

**The organiser's sidebar has a Workshops-only mode.** When the organiser picks "Workshops only", the sidebar shows only the entries marked `inWorkshops` (`src/components/event-nav-groups.ts`, `org-nav-items.ts`), so a Workshop organiser is not walked past pools, brackets and referees. The flag is required on every entry: a new one cannot be added without deciding.

## What differs

- **The admin eyebrow is tighter than the public one.** `text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500` — smaller and more letter-spaced than the root's `text-xs tracking-wider`. This is the tournament-programme entry look, and it's why an admin form doesn't read like an admin panel.
- **`FormField`, not `Input`.** `FormField` is the light admin field. `@myclash/ui`'s `Input` is a _dark_ component that no page renders any more — see [D6](known-deviations.md#d6--three-input-styles). Don't bring it back. `FormField` itself is used by few forms yet (the Workshops roster and instructor panels); most admin forms still hand-roll a tokenized field.
- **Every page opens its own container**, `mx-auto max-w-[110rem] px-6 py-8 lg:px-8`. Wider than the root default because this surface is tables. `SuperAdminShell`'s `#main-content` is a bare `flex-1` — it contributes no padding, and every page under `/admin` supplies its own. `apps/web-admin/src/components/admin-page-gutters.test.ts` reds if one forgets, which is how `/admin/data-retention` was caught rendering flush against the sidebar rail. The test holds the gutter, not the width: twenty form and settings pages open at `max-w-3xl` to `max-w-5xl` ([D22](known-deviations.md#d22--page-containers-off-the-four-widths)).
- **`AdminPageHeader` on every page.** Eyebrow → FoilMark → Fraunces H1 → Geist subtitle, over `border-b border-border pb-6 mb-10`. This is the surface's signature. It draws no horizontal padding of its own, so on a page with no container that rule runs edge to edge.
- **`DataTable` is the default container**, not `Card`. Hairline separators, no header fill. Its companions are in the same package: `SortableHeader`, `RowActionButton`, `CsvExportMenu`, and `MetricCard` / `StatsGrid` for the figures above a table.
- **`BulkActionBar`** appears on selection, in one of two placements: `top-sticky`, pinned under the page header, or `bottom-floating`. It is a white card with a hairline; only the count is a slate-900 pill.

## Surfaces added since this file was written

Each uses the scopes and the components above. What is worth knowing about each:

- **Workshops** (`/org/[slug]/events/[eventId]/workshops`). A table of Workshops with a drawer per Workshop, a schedule board (`WorkshopScheduleBoard`, a drag grid with its own local `z-*` ladder, like the Tournament schedule), and per-session rosters with check-in, a sign-in sheet to print, a message to the roster and the instructor's details. These panels are the first shipped screens built on `FormField`.
- **Event photos.** The organiser's page (`/org/[slug]/events/[eventId]/photos`): the Off / Live / Approve first mode, the QR poster and its link, the caps, a download box, and the moderation queue — tabs for Waiting, Reported and All, a tile per photo with Approve, Keep and Delete. A platform super admin has the same queue for any Event at `/admin/photos` and `/admin/photos/[eventId]`; both pages render one `PhotoQueue`. Its buttons are a known problem: [D13](known-deviations.md#d13--the-ghost-button-is-white-ink-and-it-is-used-on-light-pages).
- **FightBook safety reports.** `/org/[slug]/fightbook-flags` for a club's admins and `/admin/fightbook-flags` for the platform: a list of reports with a "handled" mark. Photos and FightBook reports both sit in the sidebar's **Operations** section.
- **Runtime health** (`/admin/system-versions`). `RuntimeHealthCard` is a grid of five tiles — database, Redis, queues, disk, photo storage — each with a status pill and label–value rows. The queue tile has one row per queue saying who works it, and turns red when nobody does. Below it `TrendChart` draws the history with the chart tokens, `chart-1` … `chart-4`: outside the specimen page it is their only consumer, and the reason they exist as a family separate from the status inks. The card's pill is a local copy ([D23](known-deviations.md#d23--hand-rolled-copies-of-shared-primitives)).

## The visual contract

**`/admin/design-system`** (`apps/web-admin/app/admin/design-system/page.tsx`) renders this surface's signature in real components: the palette, `AdminPageHeader`, `StatusBadge`, `DataTable`, `Button`, `FormField` and the FoilMark. Its docblock is the review standard:

> any PR that introduces a generic shadow-and-Inter card should fail review against what you see here.

Use it as the specimen page when changing those components. It is not the whole language — no `Modal`, `EmptyState` or `Card` — and three of its swatches and its hex labels are not on tokens: see [D5](known-deviations.md#d5--style-guide--component-retokenization-mostly-fixed).

## Don't

- **Don't** reintroduce the dark `Input` on a light admin page (D6).
- **Don't** put an accent on more than one thing per page. An organizer's table of 200 rows with a red button in each row has no accent at all.
- **Don't** use the `ghost` button on a light page: it is white ink ([D13](known-deviations.md#d13--the-ghost-button-is-white-ink-and-it-is-used-on-light-pages)). `outline` is the neutral that follows the scope.

## Deviations on this surface

[D5](known-deviations.md#d5--style-guide--component-retokenization-mostly-fixed) · [D6](known-deviations.md#d6--three-input-styles) · [D8](known-deviations.md#d8--z-index-migration-mostly-done-a-deliberate-tail-remains) · [D13](known-deviations.md#d13--the-ghost-button-is-white-ink-and-it-is-used-on-light-pages) · [D15](known-deviations.md#d15--shadows-above-the-shadow-sm-ceiling) · [D16](known-deviations.md#d16--the-auth-panels-glow) · [D17](known-deviations.md#d17--page-titles-outside-the-display-face) · [D18](known-deviations.md#d18--button-and-the-field-are-not-built-as-specified) · [D21](known-deviations.md#d21--26-files-of-packagesui-are-exempt-from-the-raw-palette-lint) · [D22](known-deviations.md#d22--page-containers-off-the-four-widths) · [D23](known-deviations.md#d23--hand-rolled-copies-of-shared-primitives) · [D24](known-deviations.md#d24--motion-without-a-reduced-motion-guard-and-keyframes-only-one-app-defines) · [D25](known-deviations.md#d25--raw-hex-in-app-code)
