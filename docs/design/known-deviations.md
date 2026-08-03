# Known deviations

Where the code disagrees with [`/DESIGN.md`](../../DESIGN.md).

**This is a bug list, not a permission slip.** Every entry is something we intend to fix. If you are about to copy an existing pattern, check here first — the thing you are copying may be the thing we are removing. Nothing on this page is licence to add a new instance.

Each entry names the rule it breaks, the files that break it, and why it hasn't been fixed yet. When you fix one, delete the entry.

---

## D1 — FIXED: ★ rating glyphs were below the non-text contrast floor

**Status: FIXED (2026-07-27). The three sites now use `text-gold-text`.**

The entry below argued `gold-text` "would render brown stars" and held out for a
darker stroke instead. That traded a real, measurable 1.4.11 failure for an
aesthetic preference, and nobody was ever going to own the stroke work. The
resolution came from the token file's own reasoning: `theme.css` documents
`--color-gold-text` as gold that "a component can use on either surface and
always be legible", the dark scope aliases it straight back to the bright
`#fbbf24`, and `referees/page.tsx` already used it elsewhere in the same file.
So the glyphs are text-tier, not fill-tier — no third gold token needed.

The alternative considered and rejected: amber-600 `#d97706`, which computes to
**3.05:1** — clearing the floor by 0.05, close enough that any future
background tweak silently re-breaks it.

**Original entry**, kept because the reasoning is still the useful part:

`--color-gold` (`#f59e0b`) is **2.06:1** against a light page. That clears nothing, but the three remaining light-surface `text-gold` sites are all ★ rating glyphs, not prose:

- `apps/web-public/app/me/instructor/InstructorDashboard.tsx:462` — `Stars`, `aria-hidden="true"` (an accessible equivalent exists)
- `apps/web-public/app/me/events/[eventSlug]/workshops/page.tsx:272` — star buttons, each with an `aria-label`
- `apps/web-admin/app/org/[slug]/events/[eventId]/referees/page.tsx:194` — same star-rating control

They are left gold deliberately: a star rating **is** the medal-ink use case, and `gold-text` (`#92400e`) would render brown stars. But be precise about what that costs — WCAG **1.4.11** wants 3:1 for non-text, and 2.06:1 misses it. So they are exempt from 1.4.3 (they are graphics with accessible names), not from 1.4.11.

**Fix when someone owns it:** give the ★ a darker stroke/outline, or pair it with a `gold-text` numeral. Do not "fix" it by recolouring the stars.

---

## D1b — FIXED: the AA text failures

Kept briefly for the record, because the shape of this bug is worth remembering.

| Pair                            | Was                                    | Now                                                            |
| ------------------------------- | -------------------------------------- | -------------------------------------------------------------- |
| white on `success`              | `#16a34a` **3.30:1**                   | `#15803d` **5.02:1**                                           |
| white on `warning`              | `#d97706` **3.19:1**                   | `#b45309` **5.02:1**                                           |
| `text-gold` as small light text | `#f59e0b` **2.06:1**                   | `gold-text` `#92400e` **6.79:1** (13 sites)                    |
| `danger` as text on a dark card | `#ef4444` **3.89:1**                   | `#f87171` **5.29:1**                                           |
| white on any dark status fill   | success **2.28:1**, warning **2.15:1** | dark scope flips `*-foreground` to `#0f172a` → 7.83:1 / 8.31:1 |

Two things this taught us:

1. **The worst one was invisible to every tool we had.** Axe runs in CI but only audits the pages it visits; these were deep admin routes and the scoring app. The token linter reads the values directly and found them in one pass.
2. **The dark-fill bug was structural, not a typo.** The dark scope lightens each status hue so it reads as _text_ on a dark surface — and that same lightening makes it unusable as a _fill_ under white text. It shipped in the scoring app, on the buttons a scorekeeper taps. `--color-strong` had solved this correctly all along (it inverts its foreground); the statuses were simply never given the same treatment.

---

## D2 — FIXED: the legacy red `#c0392b` unified onto `#b91c1c`

Every live `#c0392b` is gone. The original entry's two premises were both wrong, and finding that out changed the fix — recorded here because the wrong version is instructive:

- **"It's the `events.primary_color` DB default."** No. The column was `themes.primary_color`, and migration **0086 already dropped it** (along with 5 sibling colour/font columns; `logo_url` went in 0084). No event has received that default since 0086. So there was **no migration to write** — the drizzle `themes` table was simply carrying 7 dead columns as stale drift. Those were deleted from `packages/db/src/schema/events.ts` (verified unread: the only live theme field is `hero_image_url`).
- **"The event pages have a `#c0392b` fallback."** It wasn't a fallback — `--event-primary` has **no producer anywhere in the repo**, so `var(--event-primary, #c0392b)` rendered `#c0392b` unconditionally on every `/e/*` page. It was the _actual shipped accent_, not a safety net. The 10 sites now read `var(--color-accent)` — the token, which is `#b91c1c` on `/e/*` today and would inherit any future event tint set at the `--color-accent` level (the mechanism the contract actually specifies).

Also unified: the 5 transactional-email CTA backgrounds (`mail.service.ts` — a literal is unavoidable in email, so the value was corrected), the scoring PWA `themeColor` + `manifest.json` `theme_color`, and two `organizations.dto.ts` doc/example strings.

**Applied migrations `0001_init.sql:183` and `0085` still contain `#c0392b`** — never edited, by rule (the ledger checksums them). They are history, not live config.

**Adjacent, now also FIXED (2026-07-27):** `apps/web-scoring/public/manifest.json` `background_color` was `#1a1a2e`, an untokenized dark navy matching no token. Now `#0f172a`, the real dark `--color-background`, so the PWA splash matches the app it opens into.

---

## D3 — FIXED: `packages/design-tokens` deleted

Deleted 2026-07-17 (commit `db7b2e4c`), along with its wiring in 3 `package.json`, 3 `next.config.ts`, 3 `Dockerfile` and the CI build filter.

It had declared itself the "canonical source of truth" for a Cinzel + Inter design and was imported by **zero** source files. Proof it was dead: web-admin's emitted CSS was byte-identical before and after removal.

Worth remembering _why_ it was dangerous rather than merely dead: its radius scale used Tailwind **v3** naming (`sm: 0.125rem`, which is v4's `--radius-xs`), so anyone "reconnecting the canonical tokens" would have silently repainted ~857 `rounded-md` sites. A dead file that names itself canonical is worse than no file.

---

## D4 — `web-marketing` is still on the legacy design language

**Rule broken:** Typography (Fraunces + Geist). **Target: `web-marketing` adopts the Tournament Manual.**

`apps/web-marketing` is static HTML on Caddy. It imports no `@myclash/ui`, no `theme.css`, and hand-rolls its palette in `:root`. It runs **Cinzel + Cormorant** — the language the product left behind. This is the source of the "Cinzel + Inter" claim that survived in the docs for months.

Two specific defects on top of the font stack:

1. **Its brand red is the danger value.** `--red: #dc2626` is used as the brand red while `--red-dark: #b91c1c` — the product's actual accent — is demoted to secondary. Inverted.
2. **~~Its body font never loaded.~~** — _fixed_: `family=Cormorant+Garant` was a typo for \*Cormorant **Garamond\*** in all 6 HTML files. Google Fonts **silently drops an unknown family from a combined request** rather than erroring — the request returned `HTTP 200` with only Cinzel (860 bytes vs 2136 after the fix), so there was no 400, no console error, and no signal of any kind. Cinzel loaded; the body copy fell back to Times for months. Corrected; kept here as context for the migration, and as a reminder that a font can be silently absent.

It shares the product palette **by copy, not by import** (`#0f172a`, `#1e293b`, `#f1f5f9`, `#64748b`, `#b91c1c`, `#f59e0b` all appear in `theme.css`). Sharing values is not sharing a system: when `theme.css` moves, this app does not follow. That's an accepted cost of having no build step — and a reason the migration is worth doing.

**Why not fixed:** migrating the public homepage's type is a visible brand change to `myclash.fr` and deserves its own review.

---

## D5 — style guide + component retokenization (mostly FIXED)

**Rule:** `/admin/design-system` is the executable contract, and shared components should read tokens not raw palette classes.

**FIXED (2026-07-17):**

- **The two wrong swatches.** `/admin/design-system` showed `border-slate-200 #E2E8F0` for hairlines (token is `#e7e5e4`) and `bg-red-800 #991B1B` for "primary CTA" (accent is `#b91c1c`). All the mappable swatches now render the semantic token utilities (`bg-background`, `text-foreground`, `border-border`, `text-muted`, `bg-accent`), so the two values are corrected and the page can no longer drift from a raw hex.
- **The dead hex fallbacks in `Button.tsx` and `Card.tsx`.** Removed. Every app imports `theme.css`, so `--color-*` is always defined and the fallbacks never fired — proven zero-op by a byte-level check that no `--color-*` value changed. Card's fallbacks were also actively _wrong_ (`#111827` for a `#ffffff` surface), a textbook declarations-rot case. The stale comments claiming web-admin/web-scoring "keep the gray look via the fallbacks" went with them.
- **`AdminPageHeader` H1 + subtitle** retokenized to `text-foreground` / `text-foreground-secondary` (exact-value, zero render change).

**Still open (each needs a value-shift decision or a new token — not a silent sweep):**

- **`AdminPageHeader` eyebrow** is `text-red-800` (`#991b1b`). DESIGN.md says the eyebrow is _the accent_, but the accent is `#b91c1c` (red-700) — so the value-exact token is `accent-hover`, which is semantically the wrong token (a hover colour used at rest inverts under `[data-accent='personal']`). Fixing it to `text-accent` is correct but shifts the eyebrow red-800→red-700 across ~21 admin pages. Left for an explicit call.
- **`AdminPageHeader` border** `border-slate-200` (`#e2e8f0`) vs `border-border` (`#e7e5e4`, stone-200): sub-perceptual but non-zero.
- **`FoilMark` / FormField input border** `text-slate-300` / `border-slate-300` (`#cbd5e1`): **no token has this value.** The system has no control-border tier distinct from the card hairline, and no placeholder tier (`slate-400`). Adding those tiers is a token decision.
- **`FormField`** (its only consumer is the design-system showcase, not shipped chrome): its error text is `text-red-700` = accent-exact, but an error should be `text-danger` — the value-matching token and the correct token disagree. Wants the semantic fix, not a value-preserving swap.
- **`Button` status variants** (`danger`, `gold`, secondary, …) stay raw **on purpose**: they render in web-scoring (dark), and a solid `bg-danger`/`bg-gold` fill there was tuned for _text_ contrast, so tokenizing the fill naively would break legibility. Needs status-fill tokens distinct from status-text.
- ~~**`Button.tsx:69` `ring-offset-gray-900`**~~ **FIXED (2026-07-27)** — it was painting a near-black halo around every focused button on the light admin pages. Now `ring-offset-background`, which tracks the `[data-theme]` scope instead of assuming one. The ring hue went `ring-amber-400` → `ring-gold` in the same pass: identical on dark, a deeper amber-500 on light where it needs the contrast.
- **`Card` `CardBody`** the removed `#d1d5db` fallback shows the original intent was a _muted_ body; the var choice (`--color-foreground`) silently flattened title and body to one colour. `CardBody` should probably be `foreground-secondary` — a deliberate (visible) change, so deferred.

---

## D6 — Three input styles

**Rule broken:** Components — build from `@myclash/ui`.

| Style                     | What                                                                                                                                                                | Where                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `@myclash/ui` `Input`     | **Dark** field (`bg-gray-900 border-gray-700 text-white`, red-600 focus). Uses `gray-*` while the whole system uses `slate-*`/`stone-*`. Predates the token system. | ~15 uses in **light** admin pages — a visible mismatch                               |
| `@myclash/ui` `FormField` | The light admin-red field. The intended one.                                                                                                                        | admin forms                                                                          |
| raw tokenized inputs      | No shared component; hand-rolled `border border-border bg-surface … focus:ring-accent`                                                                              | `/me` pages, e.g. `apps/web-public/app/me/events/[eventSlug]/workshops/page.tsx:287` |

**Why not fixed:** needs a real decision (extend `FormField` to cover dark? retire `Input`?), not a sweep.

---

## D7 — FIXED: the kiosk stage is now a token (and a projector bug fixed with it)

Added `--color-stage` (`#030712`) + `--color-stage-foreground`, and migrated all the projector surfaces off `bg-gray-950`:

- `apps/web-admin/app/display/layout.tsx`
- `apps/web-public/app/e/[eventSlug]/match/[matchId]/display/display-view.tsx`
- `packages/ui/src/components/LiceWaitingDisplay.tsx` (the lice route renders this bare when idle)

The stage is deliberately deeper than `dark-background` (`#0f172a`) so the corner colours carry across a hall, and it is scope-independent — always this near-black on any theme, which is why it is its own token rather than a dark-scope override.

**Bug fixed in passing:** `LiceWaitingDisplay` had the stage background but was **missing `cursor-none`** — so a mouse pointer sat visible on the projection during the between-matches waiting state, which is the state a hall screen sits in longest. The two `<div>` wrappers had `cursor-none`; the component everyone forgot did not. Added.

---

## D8 — z-index migration (mostly done; a deliberate tail remains)

**FIXED (2026-07-17):** an audit classified all 82 bare `z-*` sites by what each element _is_. The **35 unambiguous, page-level ones** now use the named tokens: dialog backdrops / popovers → `z-overlay`, the shells' sidebars → `z-sidebar` and headers → `z-header`, sticky sub-headers → `z-sticky`, skip-links → `z-skip-link`.

32 of those were **value-preserving renames** (`z-overlay`=50, `z-sidebar`=40, `z-header`=30, `z-sticky`=20, `z-raised`=10 — same numbers), so stacking order did not move; verified every named utility emits its expected value in the built CSS. The 3 skip-links were the one real change: `focus:z-50` → `z-skip-link` (50→60), a correction so a focused skip-link sits **above** an open modal instead of tying with it (the two shells were already at 60).

**Left on bare numbers on purpose (~47 sites):** private, self-contained stacking ladders where a page-level name would *mis*describe the element. The largest is the schedule grid (`grid.tsx`): its `z-10` time-label column < `z-20` resize handles < `z-30` venue header cells is an internal ladder, not the page's header/sticky layers. Renaming those to `z-header`/`z-sticky` would be value-identical but semantically wrong, and would invite someone to "fix" the grid against the page's z-order. Also left: a handful of dropdown menus rendered _inside_ an already-stacked fixed parent (their number only competes with a sibling backdrop, so the page-level token doesn't apply). New code should use the named tokens; a number that is part of a local ladder is fine.

**Latent bug the audit found — FIXED (2026-07-27):** `BulkActionBar.tsx:46` (`z-30`, top-sticky) tied with the fixed shell header (also `z-30`) and, being later in the DOM, painted over it when pinned. Now `z-sticky` (20), which is what a sticky sub-header is: it slides **under** the page header. The `bottom-floating` variant took the value-preserving rename `z-40` → `z-sidebar` at the same time.

Radius is **not** a deviation: `rounded-md/lg/xl/full` is the vocabulary, deliberately un-aliased (see `DESIGN.md` → Shapes).

---

## Fixed

- ~~D9: `/lices` was dark while `/lices/[liceId]` was light~~ — tapping between the two piste screens flashed white. Fixed 2026-08-03: `/lices` had no `data-theme` at all, so it inherited the pad scope from `<body>`; both piste screens are now chrome and take `chromeScope`. The underlying decision — which regions are chrome — is now explicit in `apps/web-scoring/src/theme/theme.ts` rather than implied by which screen was written when.
- ~~`web-scoring` loaded no fonts at all~~ — it imported `theme.css` but never defined `--font-fraunces`/`--font-geist`/`--font-jetbrains`, so the scorer's tablet rendered display type in Georgia and body in system sans. Valid CSS, correct colours, silently wrong type. Fixed by wiring `next/font` into `apps/web-scoring/app/layout.tsx`; `pnpm design:lint` now asserts this class of bug can't recur.
- ~~`web-marketing` requested a non-existent font~~ — see D4.
