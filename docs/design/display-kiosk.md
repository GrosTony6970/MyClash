# display / kiosk — surface delta

> Delta against [`/DESIGN.md`](../../DESIGN.md). Only what this surface changes. The language, tokens and rules come from the root file — read it first.

Three routes across two apps. Not an app of its own — which is exactly why it's documented here rather than buried in either one.

| Route                                    | App        |
| ---------------------------------------- | ---------- |
| `/display/[matchId]`                     | web-admin  |
| `/e/[eventSlug]/match/[matchId]/display` | web-public |
| `/e/[eventSlug]/lice/[liceName]/display` | web-public |

## The reference, shifted

**The results board bolted to the wall of the hall**, read from the far side while walking past. Not a page of the booklet — the thing the booklet is about.

The medium changes everything; the language doesn't. Same match, same corners, same rules.

## Device & density

A projector or a big TV, **10-foot read**, legible at ~15m across a sports hall. One idea on screen. Type large enough to read from the seats.

```tsx
<div className="min-h-screen w-screen overflow-hidden bg-gray-950 cursor-none">
```

- **`cursor-none`** — there is no pointer, so **no hover state means anything**. If an affordance only appears on hover, it does not exist here.
- **Nothing is interactive.** Nobody touches this screen. It is output.
- **Chromeless** — no `SiteHeader` (`MaybeSiteHeader` strips it by regex), no sidebar, no nav. The stage is the whole viewport.

## Scopes

None. The kiosk stage is **deeper than the dark surface** — `bg-gray-950` (`#030712`) versus `dark-background` (`#0f172a`) — so the corner colours carry across a hall without competing with a lighter field behind them.

That intent is right. The implementation isn't: `#030712` matches no token, and `gray-*` is the wrong family (the system uses `slate-*` / `stone-*`). See [D7](known-deviations.md#d7--chromeless-display-routes-bypass-the-tokens).

**This delta deliberately does not invent a `kiosk-stage` token.** Adding one is a design change with its own decision to make; naming the intent and the gap in the same place is what makes it fixable later.

## What differs

- **`TVScoreboard`** — the three-column read-only projector view.
- **`LiceWaitingDisplay`** — a white branded header strip over a full-bleed dark stage, for when there's no live match.
- The corners are `corner-red` / `corner-blue` at their dark values. **Not yours to restyle** — across a hall, the corner colour is the only thing a spectator can read.

## Don't

- **Don't** add a hover state, a tooltip, or anything requiring a pointer.
- **Don't** put chrome on it. No header, no back link, no nav.
- **Don't** add a second idea to the screen. One match, or one lice.
- **Don't** size type for a desk. Size it for the back row.

## Deviations on this surface

[D7](known-deviations.md#d7--chromeless-display-routes-bypass-the-tokens)
