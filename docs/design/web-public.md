# web-public — surface delta

> Delta against [`/DESIGN.md`](../../DESIGN.md). Only what this surface changes. The language, tokens and rules come from the root file — read it first.

`app.myclash.fr` · port 3001 · Next.js App Router · a website, not an installed app: there is no manifest, and its one service worker (`public/sw.js`) only shows push notifications and is registered from the notification settings alone

## The reference, shifted

This is **the booklet itself** — the copy in the fighter's hand. Nothing is shifted; this surface _is_ the root reference. Everything else in the system is a variation on it.

The reader is standing in a sports hall with a mask under one arm and ninety seconds before their bout. That is the whole brief.

## Device & density

Mobile-first. One column of attention. Generous margins. `max-w-6xl` for content, `max-w-2xl` for forms and single-column reading.

## Scopes — this app is where the orthogonality is visible

| Route group                                                               | `data-theme`                 | `data-accent`                       | Result                                                  |
| ------------------------------------------------------------------------- | ---------------------------- | ----------------------------------- | ------------------------------------------------------- |
| `/`, `/e/*`, `/fighters`, `/clubs`, `/leagues`, profiles                  | —                            | —                                   | Light, **red**                                          |
| `/me/*`                                                                   | dark **on the sidebar only** | `personal` **on the outer wrapper** | **Light content, blue accent, dark sidebar**            |
| `/login`, `/reset-password`, `/auth/choose-password`                      | `dark`                       | `personal`                          | Dark, blue                                              |
| `/auth/oauth/callback`, `/auth/signed-in` (a line of text while it works) | —                            | —                                   | Light, red — they set neither attribute                 |
| `/e/*/match/*/display`, `/e/*/lice/*/display`                             | —                            | —                                   | Chromeless — see [`display-kiosk.md`](display-kiosk.md) |

**`/me` is the proof that the two scopes are independent.** `PublicPersonalShell.tsx` sets `data-accent="personal"` on the outer `min-h-screen` wrapper (`:209` while it loads, `:223`) but `data-theme="dark"` only on the sidebar (`:225`) and the mobile drawer (`:307`). So the content area is a _light_ surface wearing a _blue_ accent, framed by _dark_ chrome. Three facts, two switches, no coupling.

> The ratified UX contract (§5) described `/me/*` as wholesale dark. That was never what shipped. `/DESIGN.md` and this file describe the code.

Auth pages are the one place both switches are on at once — that's what makes login feel like the door to the personal space rather than a page of the public site. `/login` is the shared `AuthPanel` with `accent="personal"`; the two password pages are `PasswordPanel`, which sets both attributes itself. The two pages a Google sign-in passes through are not part of that door: they are a centred sentence on the light page.

## Event colour

**There isn't one.** Migration 0086 retired the per-event colour pickers, and `/e/*` uses the same accent as the rest of the product, `#b91c1c`. The `EventHeader` identity band carries the event's identity, and the page stays a page of the booklet.

What still varies per event is identity, not palette: the logo, the hero image, and each tournament's colour inside its own subtree.

Pages read `var(--color-accent)` directly. **Do not inline `var(--event-*, …)`** — nothing produces those variables, so the fallback is not a safety net, it is the colour that ships. That happened twice: `--event-primary` ([D2](known-deviations.md#d2--fixed-the-legacy-red-c0392b-unified-onto-b91c1c)) and `--event-accent` ([D11](known-deviations.md#d11--fixed-the-event-tint-spec-outlived-the-feature)), the second rendering raw gold at 2.06:1 on three public pages. `pnpm quality:css-vars` now rejects the shape.

## What differs

- **`SiteHeader`** on light pages, via `MaybeSiteHeader` (hidden on the TV display routes by the shared `isDisplayRoute()`). Its brand mark is the banner image (`public/brand/Banner_nobackground.png`), not a typed wordmark.
- **`PublicPersonalShell`** on `/me/*`: dark sidebar + `BottomNav` on mobile.
- **`BackLink`** on every page that is not a top-level hub — **including `/me/*` sub-pages**, or the mobile drawer becomes a trap. Hubs that don't need one: landing, the `/me` dashboard, the event home.
- **`/` is an events browser** (`PublicEventsBrowser`), _not_ a landing page. The marketing homepage is a separate app — see [`marketing.md`](marketing.md).
- **A live block says how fresh it is.** `FreshnessChip` sits on the live board and the live Match view, and `SimulatedTimeBadge` shows on every page while a super admin runs the clock off real time.
- **The quiet neutral button is `outline`** — first drawn for Share, now also the retry and report buttons of the photo pages. It is on tokens in both scopes. So is `ghost` since 2026-11-17, in the primary ink: before that it was raw white, and could not be seen on the light FightBook pages ([D13](known-deviations.md#d13--fixed-the-ghost-button-was-white-ink-on-light-pages)).

## Surfaces added since this file was written

Each uses the scopes above. What is worth knowing about each:

- **FightBook** (`/me/fightbook`, an entry of the `/me` sidebar). Light content, blue accent. Four `SegmentedTabs` — Inbox (with its count), My spars, Favourites, Find — over cards, with a settings panel on the page and the floor tools inside Find: "free to spar now", open calls, and a QR panel that shows a code or scans one through `@myclash/ui/scan`. Its dialogs are the shared `Modal`. It reaches outside `/me` in three places: an Ask button on each row and on the person page of the Event people list (`/e/[eventSlug]/people`), and an Ask button plus a "sparred N times" line on a fighter's public profile (`/fighters/[slug]`). Its forms use a field helper of their own ([D6](known-deviations.md#d6--three-input-styles)), and its favourite heart is drawn in a status ink ([D19](known-deviations.md#d19--a-status-ink-used-as-decoration)).
- **Event photos.** Three pages. `/e/[eventSlug]/photos/send` is the phone page a QR code opens: pick photos, add a name and a caption, and one row per photo with a native progress bar and a retry. `/e/[eventSlug]/photos` is the public gallery — a two- then three-column grid, newest first, a filter, Load more, and a Report under each photo that asks first — reached from a card on the Event home. `/me/events/[eventSlug]/photos` is the signed-in tab: send under your own name, see what you sent with its status, delete it.
- **Workshops.** `/e/[eventSlug]/workshops` is the catalogue with its filters; `/e/[eventSlug]/w/[workshopSlug]` is one Workshop — picture, prerequisites, instructors, sessions, and joining the Event from the page; `/e/[eventSlug]/schedule/workshops` is the grid, where a cancelled session is struck through. `/me/instructor` is the instructor's own desk: rosters with attendance ticks, and "my details". A Workshop's colour is a stripe beside its title, never the title's ink — the rule D12 left behind.
- **Smaller pages.** `/e/[eventSlug]/pass` (the Event pass and its QR), `/e/[eventSlug]/live` (the live board, with scores), `/e/[eventSlug]/display` (the hub that lists the TV screens — an ordinary page with chrome), `/e/[eventSlug]/feedback`.

## Don't

- **Don't** branch on "is it dark?" to choose an accent. The scopes are orthogonal; `/me` will break.
- **Don't** treat event colour as a theme.
- **Don't** drop `font-display` on the dark auth pages. The serif is the voice on every surface. Both auth titles break this today ([D17](known-deviations.md#d17--page-titles-outside-the-display-face)); don't copy them.

## Deviations on this surface

[D6](known-deviations.md#d6--three-input-styles) · [D8](known-deviations.md#d8--z-index-migration-mostly-done-a-deliberate-tail-remains) · [D10](known-deviations.md#d10--one-url-serves-two-languages-so-only-one-is-indexable) · [D15](known-deviations.md#d15--shadows-above-the-shadow-sm-ceiling) · [D16](known-deviations.md#d16--the-auth-panels-glow) · [D17](known-deviations.md#d17--page-titles-outside-the-display-face) · [D19](known-deviations.md#d19--a-status-ink-used-as-decoration) · [D22](known-deviations.md#d22--page-containers-off-the-four-widths) · [D23](known-deviations.md#d23--hand-rolled-copies-of-shared-primitives) · [D24](known-deviations.md#d24--motion-without-a-reduced-motion-guard-and-keyframes-only-one-app-defines)
