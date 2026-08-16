# web-admin — surface delta

> Delta against [`/DESIGN.md`](../../DESIGN.md). Only what this surface changes. The language, tokens and rules come from the root file — read it first.

`admin.myclash.fr` · port 3003 · Next.js App Router · fully auth-gated (`export const dynamic = 'force-dynamic'`)

## The reference, shifted

The root reference is the tournament programme. Admin is **the organizer's desk behind the check-in table** — the same booklet, but the copy that gets written _in_. Ledgers, entry lists, the timetable being pencilled. It is the only surface where the user is producing the booklet rather than reading it.

That makes admin the **densest** surface in the system, and the one where the "labels quiet, values loud" rule does the most work: an organizer scanning 200 registrations needs the names to be the only thing they see.

## Device & density

Desktop-first, and unapologetically so. A fixed `w-72` sidebar from `lg:` up; below that it collapses to a `w-80 max-w-[85vw]` drawer. Tables over cards. This is someone at a laptop for two hours, not a phone.

## Scopes

| Region                       | Scope               | Result                           |
| ---------------------------- | ------------------- | -------------------------------- |
| Page content                 | _(none — base)_     | Light surface, **red** accent    |
| Sidebar rail + mobile drawer | `data-theme="dark"` | Dark chrome framing a light page |

Admin never sets `data-accent`. **The accent here is always red** — blue is the personal space's identity, not a theme.

## Four shells, mutually exclusive on purpose

| Route                      | Shell                                             | Note                                                                                                             |
| -------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/admin/*` (43 pages)      | `SuperAdminShell`                                 | 6-section sidebar: Overview / Content / Operations / Platform health / AI / Settings                             |
| `/org/[slug]/*` (48 pages) | `OrganizerAdminShell` + `organizer-event-context` |                                                                                                                  |
| `/leagues/*`               | `LeagueWorkspaceShell`                            | Deliberately outside the other two: a league can be run by an account that is neither super-admin nor org member |
| `/display/[matchId]`       | _none_                                            | Chromeless projector stage — see [`display-kiosk.md`](display-kiosk.md)                                          |

The `/leagues` and `/display` layouts carry comments saying they sit outside the others intentionally. They do. Don't "unify" them.

**One cross-workspace affordance, not three.** `WorkspaceSwitcher` is the gold line directly under the logo in both sidebar shells, mounted as the first child of the shared `sidebar` node so the mobile drawer gets it too. It names the workspace you are in — "Platform Admin workspace" / "Organiser workspace" — and grows a `switchWorkspace` icon plus a popover only when the account can reach somewhere else. The platform tier lives on that popover's platform row; it is not a badge under the wordmark any more. Don't reintroduce a per-shell switch link.

## What differs

- **The admin eyebrow is tighter than the public one.** `text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500` — smaller and more letter-spaced than the root's `text-xs tracking-wider`. This is the tournament-programme entry look, and it's why an admin form doesn't read like an admin panel.
- **`FormField`, not `Input`.** `FormField` is the light admin field. `@myclash/ui`'s `Input` is a _dark_ component and is currently misused on ~15 light admin pages — see [D6](known-deviations.md#d6--three-input-styles). Don't add more.
- **Every page opens its own container**, `mx-auto max-w-[110rem] px-6 py-8 lg:px-8`. Wider than the root default because this surface is tables. `SuperAdminShell`'s `#main-content` is a bare `flex-1` — it contributes no padding, and the 41 other pages under `/admin` supply their own. `apps/web-admin/src/components/admin-page-gutters.test.ts` reds if one forgets, which is how `/admin/data-retention` was caught rendering flush against the sidebar rail.
- **`AdminPageHeader` on every page.** Eyebrow → FoilMark → Fraunces H1 → Geist subtitle, over `border-b border-slate-200 pb-6 mb-10`. This is the surface's signature. It draws no horizontal padding of its own, so on a page with no container that rule runs edge to edge.
- **`DataTable` is the default container**, not `Card`. Hairline separators, no header fill.
- **`BulkActionBar`** appears on selection: sticky bottom, slate-900 ink card.

## The visual contract

**`/admin/design-system`** (`apps/web-admin/app/admin/design-system/page.tsx`) renders this surface's whole language in real components. Its docblock is the review standard:

> any PR that introduces a generic shadow-and-Inter card should fail review against what you see here.

Use it as the specimen page when changing shared components. It has drifted from the tokens in two swatches — see [D5](known-deviations.md#d5--the-living-style-guide-has-drifted-from-the-tokens).

## Don't

- **Don't** use the dark `Input` on a light admin page (D6).
- **Don't** put an accent on more than one thing per page. An organizer's table of 200 rows with a red button in each row has no accent at all.
- **Don't** add solid `bg-success` / `bg-warning` buttons with white text — they fail WCAG AA ([D1](known-deviations.md#d1--success-and-warning-fail-wcag-aa-as-text-colours)).

## Deviations on this surface

[D1](known-deviations.md#d1--success-and-warning-fail-wcag-aa-as-text-colours) · [D5](known-deviations.md#d5--the-living-style-guide-has-drifted-from-the-tokens) · [D6](known-deviations.md#d6--three-input-styles) · [D8](known-deviations.md#d8--bare-z--and-rounded--numbers)
