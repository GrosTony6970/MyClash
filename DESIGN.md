---
name: MyClash Tournament Manual
description: >-
  The design language of MyClash, a HEMA tournament platform. Every screen is a
  page of a printed tournament programme: two inks on warm paper, a serif with a
  voice for the headings, a plain face for the numbers you read at a glance. The
  tokens below are the supporting record. The Overview is the design.
version: alpha
colors:
  # ── Base scope: light surface, red accent. The default in every app. ──
  background: '#fafaf9' # stone-50 — the page
  surface: '#ffffff' # white — cards / raised panels
  foreground: '#0f172a' # slate-900 — primary text / headings
  foreground-secondary: '#475569' # slate-600 — secondary text
  muted: '#64748b' # slate-500 — tertiary / muted text
  border: '#e7e5e4' # stone-200 — hairlines

  accent: '#b91c1c' # red-700 — the one live action on the page
  accent-hover: '#991b1b' # red-800
  accent-foreground: '#ffffff'
  # ALIAS, not a second token. The DESIGN.md format wants a token named
  # `primary`; this system's live variable is --color-accent. See Colors.
  primary: '{colors.accent}'

  gold: '#f59e0b' # gold-500 — FILLS/medals/icons/large type. NEVER a warning.
  gold-text: '#92400e' # amber-800 — gold as SMALL TEXT on light. 6.79:1.

  # Strong: a dark-neutral action surface. Not accent, not foreground.
  strong: '#0f172a' # slate-900
  strong-foreground: '#ffffff'
  strong-hover: '#020617' # slate-950

  # Status: badges and alerts only. Never the page accent.
  danger: '#dc2626' # red-600
  danger-foreground: '#ffffff'
  danger-hover: '#b91c1c'
  success: '#15803d' # green-700 — 5.02:1 under white
  success-foreground: '#ffffff'
  success-hover: '#166534' # green-800
  warning: '#b45309' # amber-700 — the warning. Not `gold`. 5.02:1 under white
  warning-foreground: '#ffffff'
  warning-hover: '#92400e' # amber-800
  info: '#2563eb' # blue-600
  info-foreground: '#ffffff'
  info-hover: '#1d4ed8'
  instructor: '#7c3aed' # violet-600 — instructor role pill
  instructor-foreground: '#ffffff'

  # Domain: the fighter's corner. Rule semantics, not decoration.
  # DEFAULTS ONLY — the live colour is per-tournament, from
  # scoring_config_json.display.sideColors, resolved via sideStyle().
  corner-red: '#dc2626'
  corner-red-foreground: '#ffffff'
  corner-blue: '#2563eb'
  corner-blue-foreground: '#ffffff'

  # Stage: the chromeless projector surface. Deeper than dark, scope-independent.
  stage: '#030712' # gray-950
  stage-foreground: '#ffffff'

  # Chart: categorical series identity on a chart. NOT a status — a green line
  # on a health panel would be read as "healthy" rather than as "which line".
  # Hue AND lightness both separate, so the set survives colour blindness.
  chart-1: '#2563eb' # blue-600
  chart-2: '#c026d3' # fuchsia-600
  chart-3: '#0d9488' # teal-600
  chart-4: '#d97706' # amber-600

  # ── Accent scope [data-accent='personal'] — overrides ONLY these two. ──
  accent-personal: '#1d4ed8' # blue-700
  accent-personal-hover: '#2563eb' # blue-600

  # ── Surface scope [data-theme='dark'] — overrides ONLY these. Note the
  #    absence of a dark accent: the accent does not depend on the surface. ──
  dark-background: '#0f172a'
  dark-surface: '#1e293b'
  dark-foreground: '#f1f5f9'
  dark-foreground-secondary: '#cbd5e1'
  dark-muted: '#94a3b8'
  dark-border: '#334155'
  dark-gold: '#fbbf24' # gold-400 — brighter for contrast on dark
  dark-gold-text: '#fbbf24' # no split needed on dark: already 10.69:1
  dark-strong: '#e2e8f0' # INVERTS — a light chip on a dark page
  dark-strong-foreground: '#0f172a'
  dark-strong-hover: '#cbd5e1'
  dark-danger: '#f87171' # red-400 — 5.29:1 on a dark card
  dark-danger-hover: '#ef4444'
  dark-success: '#22c55e'
  dark-success-hover: '#16a34a'
  dark-warning: '#f59e0b'
  dark-warning-hover: '#d97706'
  dark-info: '#60a5fa'
  dark-info-hover: '#3b82f6'
  dark-instructor: '#a78bfa'
  dark-corner-red: '#ef4444'
  dark-corner-blue: '#3b82f6'
  # One step lighter, hue order preserved: a 600-weight stroke smudges on a dark card.
  dark-chart-1: '#60a5fa'
  dark-chart-2: '#e879f9'
  dark-chart-3: '#2dd4bf'
  dark-chart-4: '#fbbf24'
  # A bright chip on a dark page takes DARK ink, not white. See Colors.
  dark-danger-foreground: '#0f172a'
  dark-success-foreground: '#0f172a'
  dark-warning-foreground: '#0f172a'
  dark-info-foreground: '#0f172a'
  dark-instructor-foreground: '#0f172a'

typography:
  display:
    fontFamily: "Fraunces, 'Iowan Old Style', 'Apple Garamond', Georgia, serif"
    fontSize: 1.5rem
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5
  h1:
    fontFamily: "Fraunces, 'Iowan Old Style', 'Apple Garamond', Georgia, serif"
    fontSize: 1.5rem # text-2xl → 1.875rem at ≥640px. Exactly one per page.
    fontWeight: 700
    lineHeight: 1.25
  h2:
    fontFamily: "Fraunces, 'Iowan Old Style', 'Apple Garamond', Georgia, serif"
    fontSize: 1.125rem # text-lg → 1.25rem at ≥640px
    fontWeight: 600
    lineHeight: 1.25
  h3:
    fontFamily: "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 1rem
    fontWeight: 600
    lineHeight: 1.5
  eyebrow:
    fontFamily: "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 0.75rem # text-xs uppercase tracking-wider
    fontWeight: 600
    lineHeight: 1
    letterSpacing: 0.05em
  eyebrow-admin:
    fontFamily: "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 0.6875rem # text-[11px] — the smallest text on the screen
    fontWeight: 600
    lineHeight: 1
    letterSpacing: 0.14em

rounded:
  sm: 0.25rem
  md: 0.375rem # controls — buttons, inputs, selects
  lg: 0.5rem # panels, dialogs
  xl: 0.75rem # cards
  2xl: 1rem
  full: 9999px # pills — badges, chips, avatars

spacing:
  unit: 0.25rem # the 4px grid
  gutter: 1rem # px-4
  gutter-sm: 1.5rem # sm:px-6
  gutter-lg: 2rem # lg:px-8
  section: 1.5rem # py-6
  touch-min: 2.75rem # 44px — gloved hands at the piste
  container-form: 42rem # max-w-2xl
  container-default: 72rem # max-w-6xl
  container-wide: 80rem # max-w-7xl
  container-console: 110rem # max-w-[110rem] — admin console, dense tables

components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.accent-foreground}'
    typography: '{typography.body}'
    rounded: '{rounded.md}'
    padding: 0.5rem 1rem
  button-primary-hover:
    backgroundColor: '{colors.accent-hover}'
  button-strong:
    backgroundColor: '{colors.strong}'
    textColor: '{colors.strong-foreground}'
    typography: '{typography.body}'
    rounded: '{rounded.md}'
  button-strong-hover:
    backgroundColor: '{colors.strong-hover}'
  button-danger:
    backgroundColor: '{colors.danger}'
    textColor: '{colors.danger-foreground}'
    rounded: '{rounded.md}'
  button-danger-hover:
    backgroundColor: '{colors.danger-hover}'
  card:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.xl}'
    padding: '{spacing.section}'
  page:
    backgroundColor: '{colors.background}'
    textColor: '{colors.foreground}'
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.foreground}'
    typography: '{typography.body}'
    rounded: '{rounded.md}'
    padding: 0.5rem 0.75rem
    height: '{spacing.touch-min}'
  input-label:
    textColor: '{colors.muted}'
    typography: '{typography.eyebrow-admin}'
  page-header-eyebrow:
    textColor: '{colors.accent}'
    typography: '{typography.eyebrow}'
  page-title:
    textColor: '{colors.foreground}'
    typography: '{typography.h1}'
  section-title:
    textColor: '{colors.foreground}'
    typography: '{typography.h2}'
  subsection-title:
    textColor: '{colors.foreground}'
    typography: '{typography.h3}'
  body-text:
    textColor: '{colors.foreground}'
    typography: '{typography.body}'
  secondary-text:
    textColor: '{colors.foreground-secondary}'
    typography: '{typography.body}'
  hairline:
    backgroundColor: '{colors.border}'
  badge-status:
    rounded: '{rounded.full}'
    typography: '{typography.eyebrow}'
    padding: 0.125rem 0.5rem
  badge-success:
    backgroundColor: '{colors.success}'
    textColor: '{colors.success-foreground}'
    rounded: '{rounded.full}'
  badge-warning:
    backgroundColor: '{colors.warning}'
    textColor: '{colors.warning-foreground}'
    rounded: '{rounded.full}'
  badge-danger:
    backgroundColor: '{colors.danger}'
    textColor: '{colors.danger-foreground}'
    rounded: '{rounded.full}'
  badge-info:
    backgroundColor: '{colors.info}'
    textColor: '{colors.info-foreground}'
    rounded: '{rounded.full}'
  badge-instructor:
    backgroundColor: '{colors.instructor}'
    textColor: '{colors.instructor-foreground}'
    rounded: '{rounded.full}'
  badge-placing:
    textColor: '{colors.gold}'
    typography: '{typography.eyebrow}'
    rounded: '{rounded.full}'
  code:
    typography: '{typography.mono}'
  scoreboard-corner-red:
    backgroundColor: '{colors.corner-red}'
    textColor: '{colors.corner-red-foreground}'
  scoreboard-corner-blue:
    backgroundColor: '{colors.corner-blue}'
    textColor: '{colors.corner-blue-foreground}'
---

# MyClash — Tournament Manual

## Overview

MyClash runs HEMA tournaments: registration, pools, brackets, refereeing, scoring, rankings. Its design has one reference, and everything below is a consequence of it rather than a preference.

**The reference is the printed tournament programme, and the rule book on the scorer's table.**

Specifically: the stapled booklet handed to fighters at check-in — pools, timetable, piste assignments, the rules of the ring — together with the ring-bound rule book the head judge keeps at the table, thumbed open and annotated. Think of a European federation's championship handbook, printed offset in two inks, black and one red, on warm uncoated stock. Someone who cared set it: the section headings are in a serif with an actual voice, and the tables and times are in a plain modern face because they have to be read fast and from an angle. Rules are separated by hairlines, not boxed into panels. The only ornament in the whole booklet is a small foil glyph beneath each section kicker — and gold, which appears exactly where the placings are.

This is not medieval pastiche and it is not a sports app. There are no swords, no parchment, no crossed banners. The martial part of HEMA happens on the piste; the paper's entire job is to be trustworthy and fast under bad conditions.

Every screen in MyClash is a page of that booklet. The reference decides things an adjective never could:

- **Two inks means the red is scarce.** In the booklet you don't get a red for "delete", a red for "live", and a red for the logo — you get _one_ red, and the printer charges you for it. So a page has one accent, spent on the single live action. Everything else is ink and paper. When a page has three red things on it, it has stopped being printed and started being designed.
- **Uncoated stock means nothing floats.** Paper has no glass, no glow, no drop shadow. Depth comes from a hairline rule and a half-step of background. If a card needs a shadow to be legible, the layout underneath it is wrong.
- **A booklet read standing up, in a sports hall, with a mask under one arm** means generous margins and one column of attention. Not dense — _sparse and confident_. You are being read at arm's length by someone who has ninety seconds before their bout.
- **A rule book means the labels are quiet and the values are loud.** A field label is the smallest text on the page; the fighter's name, the score, the piste number are the largest. The page announces the answer, not the question. Form fields read like entries in a tournament programme, not rows in an admin panel.
- **The gold is medal ink.** It marks a placing or a flourish. It has never, in the history of printed tournament programmes, meant "careful".
- **The corner colours are not the palette. They are the rules — and the organiser sets them.** A fighter's corner colour is whatever that tournament configured (one of eleven tokens; red and blue are merely the defaults). Where those colours appear on a scoreboard they are the record of a bout, not a design choice. So: don't restyle them, and don't hardcode them either. Resolve every fighter side through `sideStyle()` / `sideColorsFor()` from `@myclash/ui`. A surface that paints `corner-red` directly is lying to any organiser who chose green and purple.

The single recurring mark is the **FoilMark** (`packages/ui/src/components/FoilMark.tsx`): a 24×6 hairline glyph of a fencing foil's cross-guard, point left, handle right. It sits beneath section kickers and on empty states. It is the entire ornament budget of the system. Spend it there and nowhere else.

### Where the truth lives

**Token source of truth: `packages/ui/src/theme.css`.** Tailwind v4 `@theme`, plain and deliberately not `@theme inline`, so the generated utilities resolve through `var(--color-*)` and the runtime scopes can override them. Every value in the front matter above is mirrored from that file and is checked against it by `pnpm quality:design-drift`.

**There is no second token package.** `packages/design-tokens/` used to exist, called itself the "canonical source of truth", described a Cinzel + Inter design, and was imported by nothing. It was deleted on 2026-07-17. If you find a doc, comment or memory that points at it, that doc is stale — fix it.

**The executable contract is `/admin/design-system`** (`apps/web-admin/app/admin/design-system/page.tsx`) — this language in one page, in real components. Code can rot against a markdown file; it cannot rot against a route.

**Per-surface deltas:** `docs/design/{web-admin,web-public,web-staff,display-kiosk,marketing}.md`. Each states only what its surface changes.

**Where the code currently disagrees with this file: [`docs/design/known-deviations.md`](docs/design/known-deviations.md).** That register is a list of bugs, not a list of permissions. If you are about to copy an existing pattern, check it there first — the thing you are copying may be the thing we are removing.

## Colors

The palette is two inks on warm paper, plus a strictly-rationed vocabulary of signals.

**`primary` is an alias for `accent`.** The DESIGN.md format wants a token named `primary`, so the front matter provides one as a reference. It is not a second token. The live CSS variable is `--color-accent`; **`--color-primary` does not exist and must not be created.** `accent` is also the honest name: this colour is the second ink, used once per page. Calling it "primary" would imply it is the dominant colour, which is a licence to paint with it — the exact misuse the Do's and Don'ts forbid.

Colours fall into families, and the families have jurisdictions:

| Family          | Tokens                                                                           | Jurisdiction                                             |
| --------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Ink & paper** | `background`, `surface`, `foreground`, `foreground-secondary`, `muted`, `border` | Everything. The page is made of these.                   |
| **Accent**      | `accent`, `accent-hover`, `accent-foreground`                                    | The one live action on the page. Once.                   |
| **Status**      | `danger`, `success`, `warning`, `info`, `instructor`                             | Badges and alerts **only**. Never the page accent.       |
| **Strong**      | `strong`, `strong-foreground`, `strong-hover`                                    | A dark-neutral action — a slate button, a selected chip. |
| **Domain**      | `corner-red`, `corner-blue`                                                      | Corner **defaults**. Live colour: `sideStyle()`.         |
| **Stage**       | `stage`, `stage-foreground`                                                      | The chromeless projector surface only.                   |
| **Chart**       | `chart-1` … `chart-4`                                                            | Which line is which, on a chart. Never a status.         |
| **Gold**        | `gold`, `gold-text`                                                              | Placings and flourish.                                   |

### Gold is two tokens, and that is not an accident

`gold` (`#f59e0b`) is **medal ink** — fills, medals, ★ rating glyphs, icons, large display type. As _small text on a light surface_ it is **2.06:1**, so it must never be used that way. `gold-text` (`#92400e`, 6.79:1) exists for exactly that case.

They are not merged into one darker token because the amber that passes AA as text is `#b45309` — **the exact value of `warning`**. Merging would make gold indistinguishable from a warning and destroy the distinction this system is built on. The dark scope needs no split: gold is `#fbbf24` there and already clears AA, so `gold-text` points at the same value and a component can use `text-gold-text` on either surface and stay legible.

### Every colour pair here clears WCAG AA for text

That is a checked claim, not an aspiration — `pnpm design:lint` runs the contrast rule over the front matter. Two consequences worth knowing:

- **`success` and `warning` are red-700-era darks** (`#15803d`, `#b45309`), not the green-600/amber-600 you might reach for. Those failed at 3.30:1 and 3.19:1.
- **On dark, a bright chip takes dark ink.** The dark scope lightens every status hue so it reads as text on a dark surface — which makes it useless as a fill under _white_ text (white on dark `success` is 2.28:1). So the dark scope also flips `--color-*-foreground` to `#0f172a`. This is the same move `strong` already makes: it is the only other token the dark scope lightens, and it inverts its foreground for the same reason.

### The two scopes are orthogonal

This is the single most important structural fact about the colour system, and the one most likely to be got wrong.

```
[data-theme='dark']      → swaps the SURFACE   (background, surface, foreground, border, statuses, strong, corners)
[data-accent='personal'] → swaps the ACCENT    (accent, accent-hover)
```

They compose freely and neither implies the other. You can read this off the token list itself:

- **`accent` has no `dark-` twin** → the accent does not vary by surface.
- **`background` has no `-personal` twin** → the surface does not vary by accent.

`/me/*` is the proof: it renders **light content, with a blue accent, framed by a dark sidebar** — three facts produced by two independent switches. Any code that branches on "is it dark?" to decide an accent is wrong.

Note `strong` **inverts** across the surface scope: `#0f172a` on light, `#e2e8f0` on dark. It is a dark chip on a light page and a light chip on a dark page. It is the only token that does this.

### Event colour

**There isn't one, deliberately.** `/e/*` is governed by the same tokens as everything else, and the accent stays `#b91c1c` on every event. Migration 0086 retired the per-event colour pickers because they were write-only knobs — the variables they set were read by no component — and the unified design governs both apps from one set of tokens.

An event still looks like itself, through identity rather than palette: its logo, its hero image, and its tournaments' colours inside the subtree. An organisation's `brand_color` tints its cards on the public landing page.

Do not reintroduce a per-event tint by inlining `var(--event-*, …)` in a component. Nothing produces those variables, so the fallback becomes the shipped colour rather than a safety net — that shipped twice, as `#c0392b` and then as raw gold, and `pnpm quality:css-vars` now rejects the shape.

## Typography

Three faces, loaded through `next/font/google` and referenced indirectly, so a font swap is one edit:

| Face               | Role                                                                                                                    | Loaded as                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Fraunces**       | Display — H1, H2, ruleset and league names. A variable serif with an `opsz` axis, so optical sizing is free. The voice. | `--font-fraunces` → `--font-display`                 |
| **Geist**          | Body, labels, tables, numbers. Distinctive but neutral; read fast and at an angle.                                      | `--font-geist` → `--font-body`                       |
| **JetBrains Mono** | Codes, slugs, IDs.                                                                                                      | `--font-jetbrains` → `--font-display`'s mono sibling |

The indirection has a failure mode worth naming: `theme.css` declares `--font-display: var(--font-fraunces), …, Georgia, serif`. An app that imports `theme.css` but never defines `--font-fraunces` produces **valid CSS with correct colours that silently renders in Georgia**. `pnpm quality:design-drift` asserts every app defines the font variables it references, because this shipped once already.

### The scale

| Level           | Classes                                                         | Use                      |
| --------------- | --------------------------------------------------------------- | ------------------------ |
| Page title (H1) | `font-display font-bold text-2xl sm:text-3xl text-foreground`   | **Exactly one per page** |
| Section (H2)    | `font-display font-semibold text-lg sm:text-xl text-foreground` | Section headers          |
| Subsection (H3) | `font-semibold text-base text-foreground`                       | Inside sections          |
| Eyebrow / label | `text-xs font-semibold uppercase tracking-wider text-muted`     | Kickers, field labels    |
| Body            | `text-sm text-foreground` (secondary: `text-muted`)             | Content                  |

Admin has a tighter eyebrow: `text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500`. **The label is the smallest text on screen; the input value is the loudest.** That pairing is what makes a form field read like an entry in a tournament programme rather than a row in an admin panel.

## Layout

Pick **exactly one** container width per page:

| Width            | When                                                        |
| ---------------- | ----------------------------------------------------------- |
| `max-w-[110rem]` | **Admin console** — dense tables and ledgers, desktop-first |
| `max-w-7xl`      | Landing / marketing hero + grids                            |
| `max-w-6xl`      | **Default content** — events, tournaments, listings, `/me`  |
| `max-w-2xl`      | Forms, single-column reading, detail                        |

Standard padding and centring: `mx-auto px-4 py-6 sm:px-6 lg:px-8`. The admin console pads a step
wider — `mx-auto max-w-[110rem] px-6 py-8 lg:px-8` — because it is the one surface built around
200-row tables rather than reading.

**The shell never pads.** `SuperAdminShell`, `OrganizerAdminShell` and `PublicPersonalShell` all
hand their content region out as a bare `flex-1`: horizontal space is the page's own business,
because a shell that padded would fight every full-bleed grid inside it. So every page opens its
own container. A page that forgets sits flush against the sidebar rail, and any header rule it
draws runs from edge to edge — which is exactly what `/admin/data-retention` shipped.
`apps/web-admin/src/components/admin-page-gutters.test.ts` reds when an admin page forgets.

Stacking layers are tokenized (`--z-index-*` in `theme.css`), because "which number is the drawer?" is not a question anyone should answer twice:

| Token         | Value | Layer                              |
| ------------- | ----- | ---------------------------------- |
| `z-raised`    | 10    | Lifted-in-flow elements            |
| `z-sticky`    | 20    | Sticky sub-headers                 |
| `z-header`    | 30    | Page header                        |
| `z-sidebar`   | 40    | Sidebars, drawers                  |
| `z-overlay`   | 50    | Modals, dialog backdrops, popovers |
| `z-skip-link` | 60    | The skip link, above everything    |

The unambiguous sites (dialog backdrops, shells, skip-links, sticky sub-headers — 35 of them) now use the named tokens. What stays on bare numbers is deliberate: a private stacking ladder like the schedule grid's (`z-10` time labels under `z-20` handles under `z-30` header cells) is self-contained and would only be *mis*described by the page-level names. So the mapping is not mechanical — `z-50` covers both a dialog backdrop and an inline dropdown, and a `z-30` can be a page header or a grid cell. Use the named tokens in new code; where an existing number is part of a local ladder, leave it. The deviations register lists what was intentionally left.

## Elevation & Depth

This is the shortest section on purpose.

**Paper, not glass.** Depth comes from a hairline (`border-border`) and a half-step of background (`background` → `surface`). That is the whole mechanism.

`shadow-sm` is the **ceiling**, not the starting point — it accounts for roughly 165 of ~205 shadow usages in the codebase, and that ratio is the design, not an accident. There is no shadow token and there will not be one: a `--shadow-*` token would be an invitation to add shadows, and Tailwind inlines shadow values at build time anyway, so a shadow could never respond to the dark scope even if we wanted it to.

If a card needs a shadow to be legible, the layout underneath it is wrong.

## Shapes

Soft, but barely. The radius scale is Tailwind's; the _jurisdiction_ is ours:

| Radius                  | Jurisdiction                        |
| ----------------------- | ----------------------------------- |
| `rounded-md` (0.375rem) | Controls — buttons, inputs, selects |
| `rounded-lg` (0.5rem)   | Panels, dialogs                     |
| `rounded-xl` (0.75rem)  | Cards                               |
| `rounded-full`          | Pills — badges, chips, avatars      |

There are deliberately no semantic aliases (`rounded-control` and friends). Two names for one value is a migration nobody finishes; the convention above is already consistent in the code, so it is documented rather than tokenized.

The FoilMark is the only ornament. That is the budget.

## Components

Build from `@myclash/ui`. What each component is _for_ — the class lists live in the code, and the rendered truth lives at `/admin/design-system`:

- **`Button`** — `primary` is the accent-filled one live action. `strong` is the dark-neutral alternative when a page's accent is already spent. `danger` is destructive. `gold` is a flourish, not a CTA.
- **`Card`** — `surface` on `background`, hairline border, `rounded-xl`. The panel of the booklet.
- **`FormField`** — the light admin field: quiet 11px eyebrow label, loud value. The tournament-programme entry.
- **`StatusBadge` / `Badge`** — the same chip; `StatusBadge` defaults to the light surface, `Badge` to dark. Status inks only.
- **`DataTable`** — hairline separators, no header fill, small-caps muted header, `hover:bg-background`. A timetable, not a spreadsheet.
- **`AdminPageHeader`** — the signature: eyebrow in small-caps accent, FoilMark hairline beneath, H1 in Fraunces, subtitle in Geist.
- **`Modal` / `ConfirmDialog` / `PromptDialog`** — portal, focus trap, Escape. Never `window.confirm`.
- **`EmptyState`** — every zero-state. Carries the FoilMark.
- **`MatchScoreboard` / `TVScoreboard`** — the corners come from the tournament's configured `sideColors` via `sideColorsFor()`. Not yours to restyle, and not yours to hardcode.

## Do's and Don'ts

Every rule here is a **distinction**, not a taste. The Overview predicts most of a design; what remains are the domain facts about HEMA that no reference could guess.

### Colour

- **Do** spend the accent once per page, on the live action. Two inks; the red is scarce.
- **Don't** paint a page in a status colour. `danger` / `success` / `warning` / `info` are badge and alert inks. A rule book does not turn red because one bout was cancelled.
- **Do** use `gold` for placings and flourish — eyebrows, medals, a card's top rule.
- **Don't** use `gold` as a warning. It is medal ink. `warning` (`#b45309`) is the warning; `gold` (`#f59e0b`) is a podium. Two ambers, and this is the easiest mistake in the system to make.
- **Don't** use `text-gold` for small text on a light surface — it is 2.06:1. That is what `gold-text` is for. On dark, either is fine.
- **Do** reach for `strong` when you need a dark-neutral action.
- **Don't** collapse `strong`, `accent` and `foreground` into "the dark one". Three tokens, three jobs — and on dark, `strong` **inverts** while `accent` does not move at all. Code that treats them as interchangeable breaks on exactly one surface, which is how it ships.
- **Don't** restyle the corners, and **don't** paint `corner-red` / `corner-blue` at a call site. The corner is rule semantics AND per-tournament data — resolve it with `sideStyle()` / `sideColorsFor()`. The raw tokens are the defaults those helpers fall back to, nothing more. Theme the chrome around a scoreboard; leave the corners to the organiser.
- **Don't** assume dark implies blue. The scopes are orthogonal (see Colors). `/me` is light content + blue accent + dark sidebar.
- **Do** let event colour tint the accent on `/e/*`.
- **Don't** treat event colour as a third surface.
- **Don't** write a raw hex in app code. The only hex lives in `packages/ui/src/theme.css`. **`#b91c1c` is the MyClash red** — it is `--color-accent`. Its shades are tokens too: `#991b1b` is `accent-hover`, `#dc2626` is `danger`. A fourth red, the legacy `#c0392b`, used to be loose in emails, PWA chrome and event pages; it was unified onto `#b91c1c` on 2026-07-17. If you are about to type `#c0392b`, you are copying something that was removed on purpose.

### Type

- **Do** put exactly one H1 on a page, in `font-display`.
- **Do** keep the label the smallest text on screen and the value the loudest.
- **Don't** drop `font-display` on dark pages. The serif is the voice; a dark page is still a page of the same booklet.
- **Don't** import `theme.css` without defining `--font-fraunces` / `--font-geist` / `--font-jetbrains`. You will get correct colours and Georgia.
- **Don't** ship a generic shadow-and-Inter card. Quoting `/admin/design-system`: _any PR that introduces a generic shadow-and-Inter card should fail review against what you see here._

### Depth and shape

- **Do** build depth from hairlines and a half-step of background.
- **Don't** exceed `shadow-sm`. Paper doesn't float.
- **Do** respect the radius jurisdiction: `md` controls, `lg` panels, `xl` cards, `full` pills.
- **Don't** add ornament beyond the FoilMark.

### Layout and motion

- **Do** pick exactly one container width, with `mx-auto px-4 py-6 sm:px-6 lg:px-8`.
- **Do** let every page open its own container. No shell pads its content region.
- **Do** keep motion between 120–420ms and wrap every animation in a `prefers-reduced-motion` guard.
- **Don't** tokenize the animation easing. The hand-written keyframes use the CSS keyword `ease-out` (`cubic-bezier(0,0,0.58,1)`); Tailwind's `--ease-out` is `cubic-bezier(0,0,0.2,1)`. They are different curves.
