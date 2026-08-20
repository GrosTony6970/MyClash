# web-public — surface delta

> Delta against [`/DESIGN.md`](../../DESIGN.md). Only what this surface changes. The language, tokens and rules come from the root file — read it first.

`app.myclash.fr` · port 3001 · Next.js App Router · PWA

## The reference, shifted

This is **the booklet itself** — the copy in the fighter's hand. Nothing is shifted; this surface _is_ the root reference. Everything else in the system is a variation on it.

The reader is standing in a sports hall with a mask under one arm and ninety seconds before their bout. That is the whole brief.

## Device & density

Mobile-first. One column of attention. Generous margins. `max-w-6xl` for content, `max-w-2xl` for forms and single-column reading.

## Scopes — this app is where the orthogonality is visible

| Route group                                              | `data-theme`                 | `data-accent`                       | Result                                                  |
| -------------------------------------------------------- | ---------------------------- | ----------------------------------- | ------------------------------------------------------- |
| `/`, `/e/*`, `/fighters`, `/clubs`, `/leagues`, profiles | —                            | —                                   | Light, **red**                                          |
| `/me/*`                                                  | dark **on the sidebar only** | `personal` **on the outer wrapper** | **Light content, blue accent, dark sidebar**            |
| `/login`, `/reset-password`, OAuth callback              | `dark`                       | `personal`                          | Dark, blue                                              |
| `/e/*/match/*/display`, `/e/*/lice/*/display`            | —                            | —                                   | Chromeless — see [`display-kiosk.md`](display-kiosk.md) |

**`/me` is the proof that the two scopes are independent.** `PublicPersonalShell.tsx` sets `data-accent="personal"` on the outer `min-h-screen` wrapper (`:227`, `:241`) but `data-theme="dark"` only on the sidebar (`:243`) and the mobile drawer (`:325`). So the content area is a _light_ surface wearing a _blue_ accent, framed by _dark_ chrome. Three facts, two switches, no coupling.

> The ratified UX contract (§5) described `/me/*` as wholesale dark. That was never what shipped. `/DESIGN.md` and this file describe the code.

Auth pages are the one place both switches are on at once — that's what makes login feel like the door to the personal space rather than a page of the public site.

## Event colour

**There isn't one.** Migration 0086 retired the per-event colour pickers, and `/e/*` uses the same accent as the rest of the product, `#b91c1c`. The `EventHeader` identity band carries the event's identity, and the page stays a page of the booklet.

What still varies per event is identity, not palette: the logo, the hero image, and each tournament's colour inside its own subtree.

Pages read `var(--color-accent)` directly. **Do not inline `var(--event-*, …)`** — nothing produces those variables, so the fallback is not a safety net, it is the colour that ships. That happened twice: `--event-primary` ([D2](known-deviations.md#d2--fixed-the-legacy-red-c0392b-unified-onto-b91c1c)) and `--event-accent` ([D11](known-deviations.md#d11--fixed-the-event-tint-spec-outlived-the-feature)), the second rendering raw gold at 2.06:1 on three public pages. `pnpm quality:css-vars` now rejects the shape.

## What differs

- **`SiteHeader`** on light pages, via `MaybeSiteHeader` (hidden on the TV display routes by regex).
- **`PublicPersonalShell`** on `/me/*`: dark sidebar + `BottomNav` on mobile.
- **`BackLink`** on every page that is not a top-level hub — **including `/me/*` sub-pages**, or the mobile drawer becomes a trap. Hubs that don't need one: landing, the `/me` dashboard, the event home.
- **`/` is an events browser** (`PublicEventsBrowser`), _not_ a landing page. The marketing homepage is a separate app — see [`marketing.md`](marketing.md).

## Don't

- **Don't** branch on "is it dark?" to choose an accent. The scopes are orthogonal; `/me` will break.
- **Don't** treat event colour as a theme.
- **Don't** drop `font-display` on the dark auth pages. The serif is the voice on every surface.

## Deviations on this surface

[D1](known-deviations.md#d1--success-and-warning-fail-wcag-aa-as-text-colours) · [D2](known-deviations.md#d2--four-reds-c0392b-is-the-products-other-red) · [D6](known-deviations.md#d6--three-input-styles) · [D7](known-deviations.md#d7--chromeless-display-routes-bypass-the-tokens) · [D8](known-deviations.md#d8--bare-z--and-rounded--numbers) · [D10](known-deviations.md#d10--one-url-serves-two-languages-so-only-one-is-indexable)
