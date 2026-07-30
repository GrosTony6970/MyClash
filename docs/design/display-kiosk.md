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

None — but the stage has its own token. `bg-stage` (`--color-stage: #030712`) is **deeper than the dark surface** (`dark-background` `#0f172a`) so the corner colours carry across a hall without a lighter field behind them competing. It is scope-independent: a stage is always this near-black, on any theme. Its ink is `stage-foreground` (`#ffffff`).

Use `bg-stage` for a projector surface and nothing else — it is not a card, not content, not a fifth surface you reach for because you want "extra dark".

## What differs

- **`TVScoreboard`** — the three-column read-only projector view.
- **`LiceWaitingDisplay`** — a white branded header strip over a full-bleed dark stage, for when there's no live match.
- The corners are the tournament's configured `sideColors`, via `sideColorsFor(config, 'dark')`; `corner-red` / `corner-blue` at their dark values are just the fallback. **Not yours to restyle or to hardcode** — across a hall the corner colour is the only thing a spectator can read, so it has to be the colour the organiser announced.

## Don't

- **Don't** add a hover state, a tooltip, or anything requiring a pointer.
- **Don't** put chrome on it. No header, no back link, no nav.
- **Don't** add a second idea to the screen. One match, or one lice.
- **Don't** size type for a desk. Size it for the back row.

## Deviations on this surface

[D7](known-deviations.md#d7--chromeless-display-routes-bypass-the-tokens)
