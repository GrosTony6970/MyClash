# web-marketing — surface delta

> Delta against [`/DESIGN.md`](../../DESIGN.md). Only what this surface changes. The language, tokens and rules come from the root file — read it first.

`myclash.fr` (apex) · static HTML served by Caddy · **no framework, no build step**

## Read this first

**This surface does not currently follow `/DESIGN.md`. Its target is `/DESIGN.md`; its present state is drift.**

That distinction is the whole point of this file, so it is stated once, plainly:

|            |                                                                                   |
| ---------- | --------------------------------------------------------------------------------- |
| **Target** | The Tournament Manual — Fraunces + Geist, `#b91c1c` accent, the root language     |
| **Today**  | **Cinzel + Cormorant**, `#dc2626` as the brand red, a hand-rolled `:root` palette |

The gap is tracked as [D4](known-deviations.md#d4--web-marketing-is-still-on-the-legacy-design-language). Nothing in this file licenses adding more of the legacy language — it explains what is there and where it's going.

**This is where the "Cinzel + Inter" ghost came from.** That claim survived in `AGENTS.md`, `myclash.md` and `LESSONS_LEARNED.md` for months because it was _true here_ long after the three product apps had moved on. If you're reading a doc that says Cinzel is canonical, it is describing this app, and it is out of date.

## The reference, shifted

The product's reference is a booklet for someone already at the tournament. Marketing's reader is **a stranger deciding whether to run their event on this**. Different job: persuade, not operate.

That difference justifies a hero, a wider grid (`max-w-7xl`), and more air than any product surface gets. It does **not** justify a different typeface — which is the current state, not a decision.

## Device & density

Desktop + mobile web, SEO-driven. Six static files: `/`, `/en`, `/terms`, `/en/terms`, `/privacypolicy`, `/en/privacypolicy`.

## Scopes

None. No Tailwind, no `theme.css`, no `data-theme` / `data-accent`. `theme-color: #0f172a`.

It shares the product palette **by copy, not by import** — `#0f172a`, `#1e293b`, `#f1f5f9`, `#e2e8f0`, `#64748b`, `#b91c1c`, `#f59e0b` all appear in `theme.css` too, as literals typed twice.

**Sharing values is not sharing a system.** When `theme.css` moves, this app does not follow. That is an accepted cost of having no build step, and a reason the migration is worth doing.

## What differs

- **`--font-display: 'Cinzel', serif`** — an inscriptional Roman capital. Monumental, not printed-handbook. A fundamentally different claim from Fraunces.
- **`--font-body: 'Cormorant Garamond', serif`** — recently fixed; it was `'Cormorant Garant'`, a typo for a font that does not exist, so the body copy silently rendered in **Times** for months. See [D4](known-deviations.md#d4--web-marketing-is-still-on-the-legacy-design-language).
- **The palette is inverted** relative to the product: `--red: #dc2626` (the product's _danger_ value) is the brand red, while `--red-dark: #b91c1c` (the product's _actual_ accent) is secondary.

## Don't

- **Don't** copy this app's fonts or palette into anything else. It is the legacy language, not a second system to build on.
- **Don't** cite it — or `docs/prototype/` — as a design reference. `/DESIGN.md` is canonical.
- **Don't** add hexes here without noting that every one is a copy that will drift.

## Deviations on this surface

[D4](known-deviations.md#d4--web-marketing-is-still-on-the-legacy-design-language) · [D2](known-deviations.md#d2--four-reds-c0392b-is-the-products-other-red)
