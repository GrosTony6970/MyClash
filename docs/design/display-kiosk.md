# display / kiosk — surface delta

> Delta against [`/DESIGN.md`](../../DESIGN.md). Only what this surface changes. The language, tokens and rules come from the root file — read it first.

Four routes across two apps. Not an app of its own — which is exactly why it's documented here rather than buried in either one.

| Route                                    | App        | What it shows                                                   |
| ---------------------------------------- | ---------- | --------------------------------------------------------------- |
| `/display/[matchId]`                     | web-admin  | One Match — the organiser's popup, dragged to a TV              |
| `/display/wall/[eventId]`                | web-admin  | The whole Event, one row per piste — the live control room's TV |
| `/e/[eventSlug]/match/[matchId]/display` | web-public | One Match                                                       |
| `/e/[eventSlug]/lice/[liceName]/display` | web-public | One piste: its live Match, or the waiting screen                |

## The reference, shifted

**The results board bolted to the wall of the hall**, read from the far side while walking past. Not a page of the booklet — the thing the booklet is about.

The medium changes everything; the language doesn't. Same match, same corners, same rules.

## Device & density

A projector or a big TV, **10-foot read**, legible at ~15m across a sports hall. One idea on screen. Type large enough to read from the seats.

```tsx
<div className="min-h-screen w-screen overflow-hidden bg-stage cursor-none">
```

- **`cursor-none`** — there is no pointer, so **no hover state means anything**. If an affordance only appears on hover, it does not exist here.
- **Nothing is interactive**, with the exceptions below: one bar on the piste screen, two buttons on the organiser's popup. Nobody watches this screen and touches it. It is output.
- **Chromeless** — no `SiteHeader`, no legal footer, no sidebar, no nav. The stage is the whole viewport. Both public display routes are stripped by the shared `isDisplayRoute()` in `apps/web-public/src/lib/display-routes.ts`, read by `MaybeSiteHeader` and `AppLegalFooter`; they used to keep separate regexes and disagreed about the per-lice route, which left a spectator **Sign in** button on the screen the staff are handed. The two admin routes sit under `app/display/`, outside every shell, for the same reason.
- **It stays awake and it moves on by itself.** `TVScoreboard` holds a wake lock (`useWakeLock`), and a screen follows its piste from one bout to the next without a page load.

## The one interactive element

`DisplayControls` on `/e/[eventSlug]/lice/[liceName]/display`: a control bar carrying the **Lice switcher**, the **settings of this screen** (`ScreenSettings`: swap sides, fullscreen), a link to the display hub, and **staff sign-in** (the scoring pad — a referee's PIN works nowhere else).

A setting of the screen is what the person who sets a TV up changes while standing in front of it, and sees change at once. It lives in the bar (operator ruling, 2026-10-13). A way to another page is not a setting: it belongs on the hub.

The organiser's popup (`/display/[matchId]`) has no bar. Its two settings, swap sides and fullscreen, are two small translucent buttons in its top left corner, always shown: the popup is opened from the scoring pad by the person who then drags it to the TV.

It is **invisible until the screen is touched** (`pointermove` / `touchstart` / `keydown`) and fades again after ~4s idle; while shown it sets `cursor-auto` over the stage's `cursor-none`, and its Lice list is fetched on the _first_ reveal, never on mount. Projection unchanged, spectators see nothing — and the person setting the screens up can change Lice without knowing the URL scheme.

The picker itself lives one route up, at `/e/[eventSlug]/display` — an ordinary page with chrome and a pointer. **That** is the URL to hand out; these are the screens it points at.

The wall has no controls at all: no acknowledgement, no expansion, no links.

## Scopes

None — but the stage has its own token. `bg-stage` (`--color-stage: #030712`) is **deeper than the dark surface** (`dark-background` `#0f172a`) so the corner colours carry across a hall without a lighter field behind them competing. It is scope-independent: a stage is always this near-black, on any theme. Its ink is `stage-foreground` (`#ffffff`).

Use `bg-stage` for a projector surface and nothing else — it is not a card, not content, not a fifth surface you reach for because you want "extra dark".

Because no scope is set, **the page inks are wrong here**: `text-foreground` and `text-muted` resolve to their light-page values, dark on near-black. Write `text-stage-foreground`, and an opacity step of it for the quiet text. The wall does since 2026-11-17; before that it could not be read ([D14](known-deviations.md#d14--fixed-the-display-wall-wrote-page-ink-on-the-stage)). `TVScoreboard` still paints the stage's value as a raw class rather than through the token ([D7](known-deviations.md#d7--the-kiosk-stage-is-a-token-mostly-fixed-tvscoreboard-is-not-on-it)).

## The stage type scale

The stage does not use the app's type scale. It has its own, the only `--text-*` keys in `theme.css`:

| Utility               | Was (at 1920px) | Used for                           |
| --------------------- | --------------- | ---------------------------------- |
| `text-stage-score`    | `text-[24rem]`  | The score                          |
| `text-stage-clock`    | `text-9xl`      | The clock                          |
| `text-stage-verdict`  | `text-7xl`      | The verdict, "waiting for a match" |
| `text-stage-name`     | `text-5xl`      | A fighter's name                   |
| `text-stage-subtitle` | `text-3xl`      | Secondary lines                    |
| `text-stage-club`     | `text-2xl`      | Club, card and protest chips       |
| `text-stage-row`      | `text-lg`       | Header lines, a row of the wall    |
| `text-stage-label`    | `text-base`     | Small-caps labels                  |
| `text-stage-meta`     | `text-sm`       | The smallest stage text            |

Each is a `clamp()` with one rule: the cap is the fixed size it replaced, and the slope is that cap ÷ 19.2, in `vw`. So a 1920px projector sees exactly the old size, and a smaller window shrinks in proportion instead of a 24rem numeral painting over the clock. The score and the clock also cap against `vh`, because a short, wide window runs out of height first. Sizes that are not text — the avatar, the club logo — follow the same rule as `clamp()` heights written in `TVScoreboard.tsx`, since `--text-*` cannot size a box.

Never use these for app chrome, and never size stage type with the breakpoint scale.

## What differs

- **`TVScoreboard`** — the read-only projector view of one Match: a light header strip (Event, piste, bout code, what is next) and a light footer strip, the two corners with score, name, club, card chips and a protest chip each, the clock and the verdict between them, and under them the bout-flow chart and the Match history. A `FreshnessChip` appears when the screen has stopped hearing from the server. On a team bout each name carries its team's `TournamentColorDot` (size `em`, so it follows the stage's fluid type; the stage lines set `data-theme="dark"` so the dot's edge is the light ink), and the team's logo takes the photo's place, with the team name as its alt text; a team with no logo shows the initials, as a Fighter with no photo does. The Match history's rows put the dot before the team's name, and the bout-flow legend puts it beside the team's score, named by the team (`title`), since that line names no one; both take the dark scope on the stage. The header's "what is next" is a tight surface: name and dot, no logo.
- **The protest chip** (`TvProtestChip`) — a raised hand and a count beside the card chips, or `count/limit` when the Tournament sets a limit. It fades at zero like the card chips, and takes the warning tone (`bg-warning/20 text-warning`) from the limit on; the component records the contrast it was checked at. It carries a `title` nobody on a stage can hover ([D20](known-deviations.md#d20--a-tooltip-on-a-screen-with-no-pointer)).
- **`LiceWaitingDisplay`** — a white branded header strip over a full-bleed dark stage, for when there's no live match. Its verdict and "up next" accents are `amber-400`, a raw class. Its "up next" card is a tight surface: a team shows its name and its colour dot, no logo.
- **The wall** (`LiveWall`, `WallRow`) — one row per piste, worst first: a state dot, the piste, the two fighters and the score, the Match status and clock, and how late the piste runs, sized with `--text-stage-row` and `--text-stage-meta`, in the stage ink (`text-stage-foreground`, and its 60% step for the quiet cells). A `SimulatedTimeBadge` shows when a super admin runs the clock off real time, so nobody reads a rehearsal as the real day.
- The corners are the tournament's configured `sideColors`, via `sideColorsFor(config, 'dark')`; `corner-red` / `corner-blue` at their dark values are just the fallback. **Not yours to restyle or to hardcode** — across a hall the corner colour is the only thing a spectator can read, so it has to be the colour the organiser announced.

## Don't

- **Don't** add a hover state, a tooltip, or anything requiring a pointer.
- **Don't** put chrome on it. No header, no back link, no nav — the control layer above is the exception, and its links are exhausted: anything else you want to reach belongs on the hub page.
- **Don't** add a second idea to the screen. One match, or one lice — or, on the wall, one line per piste.
- **Don't** size type for a desk. Size it for the back row.

## Deviations on this surface

[D7](known-deviations.md#d7--the-kiosk-stage-is-a-token-mostly-fixed-tvscoreboard-is-not-on-it) · [D14](known-deviations.md#d14--fixed-the-display-wall-wrote-page-ink-on-the-stage) · [D15](known-deviations.md#d15--shadows-above-the-shadow-sm-ceiling) · [D20](known-deviations.md#d20--a-tooltip-on-a-screen-with-no-pointer) · [D21](known-deviations.md#d21--26-files-of-packagesui-are-exempt-from-the-raw-palette-lint)
