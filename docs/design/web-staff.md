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

- **44px minimum touch targets**, written as the literal `min-h-[44px]`. `DESIGN.md` names the size `spacing.touch-min`, but no `--spacing-touch-min` variable exists to use. Gloved hands, sweat, adrenaline.
- **Offline-first** — Dexie/IndexedDB, a service worker, and an `/offline` route. A sports hall's wifi is a rumour.
- **`appleWebApp.statusBarStyle: 'black-translucent'`**, `mobile-web-app-capable`, `manifest.json`. This runs as an installed app on a tablet, not a browser tab.

Density is the **inverse** of admin: fewer things, larger. If admin is 200 rows, scoring is one match.

## Scopes

The theme is **one stored mode**, and two scopes derive from it (`apps/web-staff/src/theme/theme.ts`):

| Mode               | Pad scope — on `<body>` | Chrome scope |
| ------------------ | ----------------------- | ------------ |
| `hybrid` (default) | `dark`                  | `light`      |
| `dark`             | `dark`                  | `dark`       |
| `light`            | `light`                 | `light`      |

| Region                                                                                                                          | Scope it takes |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `<body>`, and so the scoring pad (`MatchView`, `ScoringColumn`, `ScoringCenterControls`), `/login` and `/offline`               | pad scope      |
| `/lices`, `/lices/[liceId]`, `/desk`, `/gear`, `/photos`, `MatchHeader`, `MatchCorrectionsDrawer`, `ScanOverlay`, wrong-account | chrome scope   |

```tsx
<body data-theme={padScopeFor(themeMode)} className="bg-background font-body text-foreground min-h-screen antialiased">
```

The mode is kept in the `mc_theme` cookie and read on the server, so the first paint is already right. `ThemeSwitcher` cycles it — on the piste list, the piste header and the match header — by writing the cookie and refreshing; the layout is the only writer of the `<body>` attribute. A region never writes `data-theme="light"` by hand: it reads `chromeScope` or `padScope` from `useScoringTheme()`.

In the default mode, dark is not a preference. It's a sports hall with overhead lighting and a tablet held at an angle — high contrast, low glare. Because the pad scope is on `<body>`, every semantic class in the app resolves to that set automatically; the chrome uses the _same_ classes as the other two apps.

**The default is a hybrid, not uniformly dark.** The operator's call: _light chrome, dark scoring area_, for visual unity with admin. The scoring pad is dark — that's the surface you read mid-exchange. The piste screens, the desks, the match header and the corrections drawer are **light** — you read those between bouts, and they're the ones that look like the admin app. `hybrid` reproduces what the app looked like when the split was hardcoded, so a tablet that has never touched the switcher sees no change.

Custom properties inherit, so a light region nested under the dark `<body>` needs a real selector to override with. That is what `[data-theme='light']` in `theme.css` is for, and it is the reason those surfaces exist at all in token form: before it, "light" was inexpressible and every one of them hardcoded `slate-*`. `theme-scope-parity.test.ts` asserts the light scope restores every token the dark scope sets — a token added to one and forgotten in the other leaks the wrong value into a nested region.

> **Resolved:** `/lices` and `/lices/[liceId]` are both chrome now — each sets `data-theme={chromeScope}` on every branch, including their loading and error states, so tapping between them no longer flashes.

Scoring never sets `data-accent`. The accent is red.

## What differs

- **The corners are the content.** They aren't accents here — they're the record of the bout, and the colour is the organiser's: resolve it with `sideColorsFor(config, 'dark')`, which reads the tournament's `sideColors` and clamps a black- or white-configured side so it stays visible on the dark stage. `corner-red` / `corner-blue` are only the fallback values. **Never hardcode a side colour on this surface** — that's the root rule, and this is where breaking it would corrupt a result.
- **`StatusBadge` with an explicit `surface`.** There is no `Badge` component — the barrel exports `StatusBadge` only, defaulting to `surface='light'`. On this app pass the scope you are in: `surface={padScope}` inside the scoring pad, `surface={chromeScope}` on the lice screens. The palette is picked in JS, so unlike a semantic class it cannot follow the `[data-theme]` cascade — it has to be told.
- **Routes:** `/login`, `/lices`, `/lices/[liceId]`, `/matches/[matchId]`, `/desk`, `/gear`,
  `/photos` (online only, not a service-worker shell), `/offline`.
- **The desks, the piste list and `/photos` open with `EventBanner`.** Event name, logo and the
  TEST / CLUB / DRAFT badge, plus who is signed in and the sign-out. It is placed by each page
  _inside_ its own container — the shells here pad nothing and every page owns its `<main>`, its
  `data-theme` scope and its `min-h-screen`, so chrome rendered above that would sit unpadded,
  out of scope, and one banner-height past a single viewport. It scrolls away with the content.
  `/matches/[matchId]` renders none: that screen is read mid-bout, and a sign-out button must not
  be reachable there. `/lices/[liceId]` renders none either; it has its own `LiceHeader`.
- **The two desks are tabbed lists, not searches.** `/desk` and `/gear` fetch the whole event
  roster once and filter it in the browser, so the count on every tab is the number of rows behind
  it. `SegmentedTabs` with the count in the label, exactly as the login picker does it.
- **Motion is functional, and there is very little of it.** The clock's status chip and the centre controls pulse while a state needs attention, and the result overlay pulses its verdict (`MatchClock.tsx:178`, `ScoringCenterControls.tsx:332`, `MatchResultOverlay.tsx:155`) — Tailwind's `animate-pulse`, with no reduced-motion guard ([D24](known-deviations.md#d24--motion-without-a-reduced-motion-guard-and-keyframes-only-one-app-defines)). "Time is up" is a beep and a vibration (`useTimeUpCue`), not an animation: the scorekeeper is watching the fight. This file used to name two keyframes, `score-pop` and `shield-pulse`; they lived in the deleted `packages/design-tokens` and exist nowhere now.

## On the pad

- **Protests.** Each fighter's column has a protest button in its card-chip row (`ProtestButton`, with the `HandMark` glyph). One tap records a protest, with no question, offline like a hit, and it can be undone. The button shows the count, or `count/limit` when the Tournament sets a limit, and from the limit on it turns to the warning tone (`bg-warning/15 text-warning border-warning`). Past the limit (with a limit of 2, at the third protest and each one after it), the pad offers the penalty the Tournament configured (`ProtestControl`, `lib/protest-offer.ts`). The same button is on the round-break and result screens. It is drawn with tokens only: unlike a card, a protest has no colour of its own.
- **The sync bar.** `SyncBar`, on the pad and on the piste screen, is a thin line while all is sent, and a 44px bar with a button when the scorekeeper must act; it turns to `danger` when the server refused a press. `QuarantineInbox` is the dialog that lists what the tablet is holding back — hits, cards, whole bouts — and lets the scorekeeper retry or discard each. The sign-in screen says when the tablet still holds unsent entries (`UnsentHitsNotice`).
- **The offline drill.** `StartOfflineDrill`, on the piste list and deliberately not on the pad, puts the tablet off the network on purpose for a set time, and `OfflineDrillBanner` says so until it ends; the queue is sent then with no tap.
- **Stay awake.** The pad holds a wake lock (`useWakeLock`) for as long as a Match is open.

## The other staff screens

- **The scan lane.** `ScanOverlay`, opened from the desk, reads an Event pass with the shared camera scanner (`@myclash/ui/scan`, the one the public app uses for FightBook). It takes the chrome scope.
- **`/photos`.** The `photos` staff login lands here: the same queue as the organiser's page — `SegmentedTabs` for Waiting, Reported and All, with Approve, Keep and Delete — on a phone or a tablet, online only.
- **`/login`.** The staff sign-in: the Event, a username and a PIN. It inherits the pad scope and has no banner.

## Don't

- **Don't** assume a network. Scoring a bout must work offline and reconcile later. A few actions need the network and are refused without it: the corrections drawer (`MatchCorrectionsDrawer`), Re-open and Reset of the clock, and Unlock of a locked Match (`MatchView`).
- **Don't** add a hover state and rely on it. This is a touch device; there is no pointer.
- **Don't** shrink a target below 44px, ever, for any reason.
- **Don't** restyle the corners.

## Deviations on this surface

- [D17](known-deviations.md#d17--page-titles-outside-the-display-face) — the login, piste and pad titles are not in the display face, while the desks' are. [D24](known-deviations.md#d24--motion-without-a-reduced-motion-guard-and-keyframes-only-one-app-defines) — the pad's pulses are unguarded, and the shared dialog and toast enter with no motion here. [D15](known-deviations.md#d15--shadows-above-the-shadow-sm-ceiling) — the corrections drawer and the result overlay. [D5](known-deviations.md#d5--style-guide--component-retokenization-mostly-fixed) — a local `EmptyState` on `/desk`. [D18](known-deviations.md#d18--button-and-the-field-are-not-built-as-specified) — the 44px target is a literal, not a token.
- Resolved for this surface: [D2](known-deviations.md#d2--fixed-the-legacy-red-c0392b-unified-onto-b91c1c) (legacy red in `themeColor` / `manifest.json`) and the page-level part of [D8](known-deviations.md#d8--z-index-migration-mostly-done-a-deliberate-tail-remains); `manifest.json` `background_color` is now the real `--color-background` value.

> **Fixed:** this app previously loaded **no fonts at all** — it imported `theme.css` but never defined `--font-fraunces`/`--font-geist`/`--font-jetbrains`, so the tablet rendered display type in Georgia and body in system sans. Valid CSS, correct colours, silently wrong type. `pnpm quality:design-drift` now asserts every app defines the font variables it references.
