# Known deviations

Where the code disagrees with [`/DESIGN.md`](../../DESIGN.md).

**This is a bug list, not a permission slip.** Every entry is something we intend to fix. If you are about to copy an existing pattern, check here first — the thing you are copying may be the thing we are removing. Nothing on this page is licence to add a new instance.

Each entry names the rule it breaks, the files that break it, and why it hasn't been fixed yet. When you fix one, delete the entry.

---

## D1 — residual: ★ rating glyphs are below the non-text contrast floor

**Status: the text failures are FIXED (2026-07-17). This is what is left.**

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

## D2 — Four reds; `#c0392b` is the product's other red

**Rule broken:** _"Don't write a raw hex in app code"_ / one MyClash red. **`#b91c1c` is the red** (`DESIGN.md` → Colors).

| Red               | Where                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `#b91c1c` red-700 | `--color-accent` — **correct**                                                              |
| `#991b1b` red-800 | `--color-accent-hover` — correct, but mislabelled "primary CTA" in the style guide (see D5) |
| `#dc2626` red-600 | `--color-danger` — correct as danger, but used as the _brand_ red in web-marketing (see D4) |
| `#c0392b`         | **legacy product red** — no token                                                           |

`#c0392b` is not a stray. It is load-bearing in four places:

- **Database default** — `packages/db/src/schema/events.ts:39` and `packages/db/migrations/0001_init.sql:183`: `events.primary_color` defaults to `#c0392b`. Every event created without a colour gets it.
- **Transactional email CTAs** — `apps/api/src/modules/mail/mail.service.ts` (5 occurrences, inline `style="background:#c0392b"`). Email cannot read CSS variables, so _some_ literal is unavoidable here; the value is what's wrong.
- **Scoring PWA chrome** — `apps/web-scoring/app/layout.tsx:26` (`themeColor`) and `apps/web-scoring/public/manifest.json:8` (`theme_color`).
- **Event-page fallbacks** — ~15 inline `var(--event-primary, #c0392b)` across `apps/web-public/app/e/[eventSlug]/**`. Note the ratified contract specified the fallback as `#b91c1c`; the code shipped `#c0392b`.

**Why not fixed:** changing the DB default needs a migration and a decision about existing rows; the email colour is a visible brand change. Sequence it deliberately, not as a find-and-replace.

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

## D5 — The living style guide has drifted from the tokens

**Rule broken:** `/admin/design-system` is the executable contract — so it must be right.

`apps/web-admin/app/admin/design-system/page.tsx` hardcodes swatch values that no longer match `theme.css`:

| Swatch says                     | Token actually is                                      |
| ------------------------------- | ------------------------------------------------------ |
| hairlines `#E2E8F0` (slate-200) | `--color-border: #e7e5e4` (stone-200)                  |
| "primary CTA" `#991B1B`         | that's `--color-accent-hover`; the accent is `#b91c1c` |

Related: `AdminPageHeader.tsx` and `FormField.tsx` — the two best in-code definitions of the aesthetic — use raw palette classes (`text-red-800`, `border-slate-200`, `text-slate-900`) rather than tokens. `packages/ui` also carries dark hex fallbacks: `Button.tsx:33`, `Card.tsx:18-19,49,63`.

**Why not fixed:** mechanical but broad; wants one focused retokenization pass with a visual diff.

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

## D7 — Chromeless display routes bypass the tokens

**Rule broken:** _"Don't write a raw hex"_ / token discipline.

The three projector routes use `bg-gray-950` (`#030712`) — matches no token, and uses `gray-*` where the system uses `slate-*`:

- `apps/web-admin/app/display/layout.tsx`
- `apps/web-public/app/e/[eventSlug]/match/[matchId]/display/`
- `apps/web-public/app/e/[eventSlug]/lice/[liceName]/display/`

The **intent** is sound: the kiosk stage is deliberately deeper than `dark-background` (`#0f172a`) so the corner colours carry across a hall. The gap is that the intent isn't tokenized.

**Why not fixed:** adding a `kiosk-stage` token is a design change, not a codification. See [`display-kiosk.md`](display-kiosk.md).

---

## D8 — Bare `z-*` and `rounded-*` numbers

**Rule broken:** Layout — use the named `z-*` tokens.

`theme.css` now defines `--z-index-{raised,sticky,header,sidebar,overlay,skip-link}`, but existing code still uses bare numbers (`z-50` ×24, `z-30` ×17, `z-20` ×17, `z-10` ×15, `z-40` ×7, `z-[60]` ×2).

**The mapping is not mechanical** — today `z-10`/`z-20`/`z-30` each cover _both_ dropdown menus and resize handles, and `z-50` covers both dialog backdrops (`dialog-enter fixed inset-0 z-50`) and inline dropdowns (`absolute z-50 mt-1`). Migrating needs an audit that decides what each site _means_, not a find-and-replace.

Radius is **not** a deviation: `rounded-md/lg/xl/full` is the vocabulary, deliberately un-aliased (see `DESIGN.md` → Shapes).

**Why not fixed:** the audit is the work. New code should use the named tokens.

---

## Fixed

- ~~`web-scoring` loaded no fonts at all~~ — it imported `theme.css` but never defined `--font-fraunces`/`--font-geist`/`--font-jetbrains`, so the scorer's tablet rendered display type in Georgia and body in system sans. Valid CSS, correct colours, silently wrong type. Fixed by wiring `next/font` into `apps/web-scoring/app/layout.tsx`; `pnpm design:lint` now asserts this class of bug can't recur.
- ~~`web-marketing` requested a non-existent font~~ — see D4.
