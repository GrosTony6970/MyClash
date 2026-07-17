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

  gold: '#f59e0b' # gold-500 — placings and flourish. NEVER a warning.

  # Strong: a dark-neutral action surface. Not accent, not foreground.
  strong: '#0f172a' # slate-900
  strong-foreground: '#ffffff'
  strong-hover: '#020617' # slate-950

  # Status: badges and alerts only. Never the page accent.
  danger: '#dc2626' # red-600
  danger-foreground: '#ffffff'
  danger-hover: '#b91c1c'
  success: '#16a34a' # green-600
  success-foreground: '#ffffff'
  success-hover: '#15803d'
  warning: '#d97706' # gold-600 — the warning. Not `gold`.
  warning-foreground: '#ffffff'
  warning-hover: '#b45309'
  info: '#2563eb' # blue-600
  info-foreground: '#ffffff'
  info-hover: '#1d4ed8'
  instructor: '#7c3aed' # violet-600 — instructor role pill
  instructor-foreground: '#ffffff'

  # Domain: the fighter's corner. Rule semantics, not decoration.
  corner-red: '#dc2626'
  corner-red-foreground: '#ffffff'
  corner-blue: '#2563eb'
  corner-blue-foreground: '#ffffff'

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
  dark-strong: '#e2e8f0' # INVERTS — a light chip on a dark page
  dark-strong-foreground: '#0f172a'
  dark-strong-hover: '#cbd5e1'
  dark-danger: '#ef4444'
  dark-danger-hover: '#dc2626'
  dark-success: '#22c55e'
  dark-success-hover: '#16a34a'
  dark-warning: '#f59e0b'
  dark-warning-hover: '#d97706'
  dark-info: '#60a5fa'
  dark-info-hover: '#3b82f6'
  dark-instructor: '#a78bfa'
  dark-corner-red: '#ef4444'
  dark-corner-blue: '#3b82f6'

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
- **Red and blue are not the palette. They are the rules.** A fighter's corner is red or blue because the ruleset says so. Where those colours appear on a scoreboard they are the record of a bout, not a design choice, and they are not yours to restyle.

The single recurring mark is the **FoilMark** (`packages/ui/src/components/FoilMark.tsx`): a 24×6 hairline glyph of a fencing foil's cross-guard, point left, handle right. It sits beneath section kickers and on empty states. It is the entire ornament budget of the system. Spend it there and nowhere else.

### Where the truth lives

**Token source of truth: `packages/ui/src/theme.css`.** Tailwind v4 `@theme`, plain and deliberately not `@theme inline`, so the generated utilities resolve through `var(--color-*)` and the runtime scopes can override them. Every value in the front matter above is mirrored from that file and is checked against it by `pnpm design:lint`.

**`packages/design-tokens/` is dead.** It calls itself the "canonical source of truth" and describes a Cinzel + Inter design. It is imported by no application code, it renders nothing, and it is wrong. Do not read it, do not extend it, do not copy values from it — its radius scale uses Tailwind v3 naming and would repaint the app.

**The executable contract is `/admin/design-system`** (`apps/web-admin/app/admin/design-system/page.tsx`) — this language in one page, in real components. Code can rot against a markdown file; it cannot rot against a route.

**Per-surface deltas:** `docs/design/{web-admin,web-public,web-scoring,display-kiosk,marketing}.md`. Each states only what its surface changes.

**Where the code currently disagrees with this file: [`docs/design/known-deviations.md`](docs/design/known-deviations.md).** That register is a list of bugs, not a list of permissions. If you are about to copy an existing pattern, check it there first — the thing you are copying may be the thing we are removing.

## Colors

The palette is two inks on warm paper, plus a strictly-rationed vocabulary of signals.

**`primary` is an alias for `accent`.** The DESIGN.md format wants a token named `primary`, so the front matter provides one as a reference. It is not a second token. The live CSS variable is `--color-accent`; **`--color-primary` does not exist and must not be created.** `accent` is also the honest name: this colour is the second ink, used once per page. Calling it "primary" would imply it is the dominant colour, which is a licence to paint with it — the exact misuse the Do's and Don'ts forbid.

Colours fall into five families, and the families have jurisdictions:

| Family          | Tokens                                                                           | Jurisdiction                                             |
| --------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Ink & paper** | `background`, `surface`, `foreground`, `foreground-secondary`, `muted`, `border` | Everything. The page is made of these.                   |
| **Accent**      | `accent`, `accent-hover`, `accent-foreground`                                    | The one live action on the page. Once.                   |
| **Status**      | `danger`, `success`, `warning`, `info`, `instructor`                             | Badges and alerts **only**. Never the page accent.       |
| **Strong**      | `strong`, `strong-foreground`, `strong-hover`                                    | A dark-neutral action — a slate button, a selected chip. |
| **Domain**      | `corner-red`, `corner-blue`                                                      | The fighter's corner. Rule semantics.                    |
| **Gold**        | `gold`                                                                           | Placings and flourish.                                   |

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

On `/e/*` an organizer's colour tints the accent: `--color-accent: var(--event-primary, #b91c1c)`. It tints **one token**. Event colour is not a third surface — it gets no background, no type, and no rules of its own.

## Typography

Three faces, loaded through `next/font/google` and referenced indirectly, so a font swap is one edit:

| Face               | Role                                                                                                                    | Loaded as                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Fraunces**       | Display — H1, H2, ruleset and league names. A variable serif with an `opsz` axis, so optical sizing is free. The voice. | `--font-fraunces` → `--font-display`                 |
| **Geist**          | Body, labels, tables, numbers. Distinctive but neutral; read fast and at an angle.                                      | `--font-geist` → `--font-body`                       |
| **JetBrains Mono** | Codes, slugs, IDs.                                                                                                      | `--font-jetbrains` → `--font-display`'s mono sibling |

The indirection has a failure mode worth naming: `theme.css` declares `--font-display: var(--font-fraunces), …, Georgia, serif`. An app that imports `theme.css` but never defines `--font-fraunces` produces **valid CSS with correct colours that silently renders in Georgia**. `pnpm design:lint` asserts every app defines the font variables it references, because this shipped once already.

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

| Width       | When                                                       |
| ----------- | ---------------------------------------------------------- |
| `max-w-7xl` | Landing / marketing hero + grids                           |
| `max-w-6xl` | **Default content** — events, tournaments, listings, `/me` |
| `max-w-2xl` | Forms, single-column reading, detail                       |

Standard padding and centring: `mx-auto px-4 py-6 sm:px-6 lg:px-8`.

Stacking layers are tokenized (`--z-index-*` in `theme.css`), because "which number is the drawer?" is not a question anyone should answer twice:

| Token         | Value | Layer                              |
| ------------- | ----- | ---------------------------------- |
| `z-raised`    | 10    | Lifted-in-flow elements            |
| `z-sticky`    | 20    | Sticky sub-headers                 |
| `z-header`    | 30    | Page header                        |
| `z-sidebar`   | 40    | Sidebars, drawers                  |
| `z-overlay`   | 50    | Modals, dialog backdrops, popovers |
| `z-skip-link` | 60    | The skip link, above everything    |

Existing code still uses the bare numbers (`z-50`), and the mapping is not mechanical — today `z-50` covers both dialog backdrops and inline dropdowns. Use the named tokens in new code; migration is tracked in the deviations register.

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
- **`MatchScoreboard` / `TVScoreboard`** — the corners are `corner-red` / `corner-blue`. Not yours to restyle.

## Do's and Don'ts

Every rule here is a **distinction**, not a taste. The Overview predicts most of a design; what remains are the domain facts about HEMA that no reference could guess.

### Colour

- **Do** spend the accent once per page, on the live action. Two inks; the red is scarce.
- **Don't** paint a page in a status colour. `danger` / `success` / `warning` / `info` are badge and alert inks. A rule book does not turn red because one bout was cancelled.
- **Do** use `gold` for placings and flourish — eyebrows, medals, a card's top rule.
- **Don't** use `gold` as a warning. It is medal ink. `warning` (`#d97706`) is the warning; `gold` (`#f59e0b`) is a podium. They are two ambers a few hex apart and this is the easiest mistake in the system to make.
- **Do** reach for `strong` when you need a dark-neutral action.
- **Don't** collapse `strong`, `accent` and `foreground` into "the dark one". Three tokens, three jobs — and on dark, `strong` **inverts** while `accent` does not move at all. Code that treats them as interchangeable breaks on exactly one surface, which is how it ships.
- **Don't** restyle `corner-red` / `corner-blue`. The corner is rule semantics. Theme the chrome around a scoreboard; leave the corners alone.
- **Don't** assume dark implies blue. The scopes are orthogonal (see Colors). `/me` is light content + blue accent + dark sidebar.
- **Do** let event colour tint the accent on `/e/*`.
- **Don't** treat event colour as a third surface.
- **Don't** write a raw hex in app code. The only hex lives in `packages/ui/src/theme.css`. There are already four reds loose in this repo — `#b91c1c` (accent), `#991b1b` (its hover), `#dc2626` (danger), `#c0392b` (legacy) — because this rule was broken four times. **`#b91c1c` is the MyClash red.** The rest are tracked in the deviations register.

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
- **Do** keep motion between 120–420ms and wrap every animation in a `prefers-reduced-motion` guard.
- **Don't** tokenize the animation easing. The hand-written keyframes use the CSS keyword `ease-out` (`cubic-bezier(0,0,0.58,1)`); Tailwind's `--ease-out` is `cubic-bezier(0,0,0.2,1)`. They are different curves.
