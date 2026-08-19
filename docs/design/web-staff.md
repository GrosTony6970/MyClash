# web-staff — surface delta

> Delta against [`/DESIGN.md`](../../DESIGN.md). Only what this surface changes. The language, tokens and rules come from the root file — read it first.

`staff.myclash.fr` · port 3002 · Next.js App Router · offline-first PWA

## The reference, shifted

Not the booklet — **the scoresheet clipped to the board at the piste**, held by someone who is also watching a fight. The root reference assumes a reader with ninety seconds. This one assumes a reader with **two**, between exchanges, who cannot look down for long.

Everything below follows from that.

## Device & density

Tablet-first, and locked down for it:

```ts
export const viewport: Viewport = {
  themeColor: '#b91c1c',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // kiosk lock — no pinch-zoom mid-bout
};
```

- **44px minimum touch targets** (`min-h-[44px]` / `--spacing-touch-min`). Gloved hands, sweat, adrenaline.
- **Offline-first** — Dexie/IndexedDB, a service worker, and an `/offline` route. A sports hall's wifi is a rumour.
- **`appleWebApp.statusBarStyle: 'black-translucent'`**, `mobile-web-app-capable`, `manifest.json`. This runs as an installed app on a tablet, not a browser tab.

Density is the **inverse** of admin: fewer things, larger. If admin is 200 rows, scoring is one match.

## Scopes

| Region                                                                    | Scope                | Result                                      |
| ------------------------------------------------------------------------- | -------------------- | ------------------------------------------- |
| Default — set on `<body>`                                                 | `data-theme="dark"`  | **The only globally dark app**              |
| `/lices/[liceId]`, `MatchHeader`, `MatchCorrectionsDrawer` (+ its panels) | `data-theme="light"` | Light chrome nested inside the dark default |

```tsx
<body data-theme="dark" className="bg-background text-foreground min-h-screen">
```

Dark here is not a preference. It's a sports hall with overhead lighting and a tablet held at an angle — high contrast, low glare. Because the scope is on `<body>`, every semantic class in the app resolves to the dark set automatically; the chrome uses the _same_ classes as the other two apps.

**But the app is a hybrid, not uniformly dark.** The operator's call: _light chrome, dark scoring area_, for visual unity with admin. The scoring pad (`MatchView`, `ScoringColumn`, `ScoringCenterControls`) is dark — that's the surface you read mid-exchange. The match list for a piste, the match header and the corrections drawer are **light** — you read those between bouts, and they're the ones that look like the admin app.

Custom properties inherit, so a light region nested under the dark `<body>` needs a real selector to override with. That is what `[data-theme='light']` in `theme.css` is for, and it is the reason those surfaces exist at all in token form: before it, "light" was inexpressible and every one of them hardcoded `slate-*`. `theme-scope-parity.test.ts` asserts the light scope restores every token the dark scope sets — a token added to one and forgotten in the other leaks the wrong value into a nested region.

> **Resolved:** `/lices` and `/lices/[liceId]` are both chrome now — each sets `data-theme={chromeScope}` on every branch, including their loading and error states, so tapping between them no longer flashes.

Scoring never sets `data-accent`. The accent is red.

## What differs

- **The corners are the content.** They aren't accents here — they're the record of the bout, and the colour is the organiser's: resolve it with `sideColorsFor(config, 'dark')`, which reads the tournament's `sideColors` and clamps a black- or white-configured side so it stays visible on the dark stage. `corner-red` / `corner-blue` are only the fallback values. **Never hardcode a side colour on this surface** — that's the root rule, and this is where breaking it would corrupt a result.
- **`StatusBadge` with an explicit `surface`.** There is no `Badge` component — the barrel exports `StatusBadge` only, defaulting to `surface='light'`. On this app pass the scope you are in: `surface={padScope}` inside the scoring pad, `surface={chromeScope}` on the lice screens. The palette is picked in JS, so unlike a semantic class it cannot follow the `[data-theme]` cascade — it has to be told.
- **Routes:** `/lices`, `/lices/[liceId]`, `/matches/[matchId]`, `/offline`.
- **Motion is functional.** `score-pop` (0.3s) and `shield-pulse` exist to make a score change _impossible to miss_ in peripheral vision. That's the one place motion earns its keep in this system.

## Don't

- **Don't** assume a network. Every interaction must work offline and reconcile later.
- **Don't** add a hover state and rely on it. This is a touch device; there is no pointer.
- **Don't** shrink a target below 44px, ever, for any reason.
- **Don't** restyle the corners.

## Deviations on this surface

- None outstanding. [D2](known-deviations.md#d2--four-reds-c0392b-is-the-products-other-red) (legacy red in `themeColor` / `manifest.json`) and [D8](known-deviations.md#d8--bare-z--and-rounded--numbers) are both resolved for this surface; `manifest.json` `background_color` is now the real `--color-background` value.

> **Fixed:** this app previously loaded **no fonts at all** — it imported `theme.css` but never defined `--font-fraunces`/`--font-geist`/`--font-jetbrains`, so the tablet rendered display type in Georgia and body in system sans. Valid CSS, correct colours, silently wrong type. `pnpm quality:design-drift` now asserts every app defines the font variables it references.
