# web-scoring — surface delta

> Delta against [`/DESIGN.md`](../../DESIGN.md). Only what this surface changes. The language, tokens and rules come from the root file — read it first.

`scoring.myclash.fr` · port 3002 · Next.js App Router · offline-first PWA

## The reference, shifted

Not the booklet — **the scoresheet clipped to the board at the piste**, held by someone who is also watching a fight. The root reference assumes a reader with ninety seconds. This one assumes a reader with **two**, between exchanges, who cannot look down for long.

Everything below follows from that.

## Device & density

Tablet-first, and locked down for it:

```ts
export const viewport: Viewport = {
  themeColor: '#c0392b',
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

| Region                       | Scope               | Result                         |
| ---------------------------- | ------------------- | ------------------------------ |
| Everything — set on `<body>` | `data-theme="dark"` | **The only globally dark app** |

```tsx
<body data-theme="dark" className="bg-background text-foreground min-h-screen">
```

Dark here is not a preference. It's a sports hall with overhead lighting and a tablet held at an angle — high contrast, low glare. Because the scope is on `<body>`, every semantic class in the app resolves to the dark set automatically; the chrome uses the _same_ classes as the other two apps.

Scoring never sets `data-accent`. The accent is red.

## What differs

- **The corners are the content.** `corner-red` / `corner-blue` aren't accents here — they're the record of the bout. On dark they brighten a step (`#ef4444` / `#3b82f6`) for contrast. **They are not yours to restyle** — that's the root rule, and this is the surface where breaking it would corrupt a result.
- **`Badge`, not `StatusBadge`.** `Badge` defaults to the dark surface; `StatusBadge` defaults to light. Same chip, different default.
- **Routes:** `/lices`, `/lices/[liceId]`, `/matches/[matchId]`, `/offline`.
- **Motion is functional.** `score-pop` (0.3s) and `shield-pulse` exist to make a score change _impossible to miss_ in peripheral vision. That's the one place motion earns its keep in this system.

## Don't

- **Don't** assume a network. Every interaction must work offline and reconcile later.
- **Don't** add a hover state and rely on it. This is a touch device; there is no pointer.
- **Don't** shrink a target below 44px, ever, for any reason.
- **Don't** restyle the corners.

## Deviations on this surface

- `themeColor: '#c0392b'` (`app/layout.tsx:26`) and `manifest.json:8` use the legacy red — see [D2](known-deviations.md#d2--four-reds-c0392b-is-the-products-other-red).
- [D8](known-deviations.md#d8--bare-z--and-rounded--numbers)

> **Fixed:** this app previously loaded **no fonts at all** — it imported `theme.css` but never defined `--font-fraunces`/`--font-geist`/`--font-jetbrains`, so the tablet rendered display type in Georgia and body in system sans. Valid CSS, correct colours, silently wrong type. `pnpm design:lint` now asserts every app defines the font variables it references.
