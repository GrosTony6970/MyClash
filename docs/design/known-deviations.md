# Known deviations

Where the code disagrees with [`/DESIGN.md`](../../DESIGN.md).

**This is a bug list, not a permission slip.** Every entry is something we intend to fix. If you are about to copy an existing pattern, check here first — the thing you are copying may be the thing we are removing. Nothing on this page is licence to add a new instance.

Each entry names the rule it breaks, the files that break it, and why it hasn't been fixed yet. When you fix one, mark its heading **FIXED** and keep the entry: entries are cited by number from other files (`CLAUDE.md` cites D2), so one is never deleted and never renumbered. A new entry takes the next free number.

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

- `apps/web-public/app/me/instructor/InstructorDashboard.tsx:546` — `Stars`, `aria-hidden="true"` (an accessible equivalent exists)
- `apps/web-public/app/me/events/[eventSlug]/workshops/page.tsx:362` — star buttons, each with an `aria-label`
- `apps/web-admin/app/org/[slug]/events/[eventId]/referees/page.tsx:218` — same star-rating control

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

- **"It's the `events.primary_color` DB default."** No. The column was `themes.primary_color`, and migration **0086 already dropped it** (along with 5 sibling colour/font columns; `logo_url` went in 0084). No event has received that default since 0086. So there was **no migration to write** — the drizzle `themes` table was simply carrying 7 dead columns as stale drift. Those were deleted from the Drizzle schema mirror at the time (verified unread: the only live theme field is `hero_image_url`); the whole mirror has since gone, and `packages/db` now carries migrations only.
- **"The event pages have a `#c0392b` fallback."** It wasn't a fallback — `--event-primary` has **no producer anywhere in the repo**, so `var(--event-primary, #c0392b)` rendered `#c0392b` unconditionally on every `/e/*` page. It was the _actual shipped accent_, not a safety net. The 10 sites now read `var(--color-accent)` — the token, which is `#b91c1c` on `/e/*`. This entry originally added "and would inherit any future event tint set at the `--color-accent` level, the mechanism the contract actually specifies". That was true of the contract as written and false of the product: migration 0086 had already retired per-event colour. The contract caught up on 2026-08-20 — see [D11](#d11--fixed-the-event-tint-spec-outlived-the-feature).

Also unified: the 5 transactional-email CTA backgrounds (`mail.service.ts` — a literal is unavoidable in email, so the value was corrected), the scoring PWA `themeColor` + `manifest.json` `theme_color`, and two `organizations.dto.ts` doc/example strings.

**Applied migrations `0001_init.sql:183` and `0085` still contain `#c0392b`** — never edited, by rule (the ledger checksums them). They are history, not live config.

**Adjacent, now also FIXED (2026-07-27):** `apps/web-staff/public/manifest.json` `background_color` was `#1a1a2e`, an untokenized dark navy matching no token. Now `#0f172a`, the real dark `--color-background`, so the PWA splash matches the app it opens into.

---

## D3 — FIXED: `packages/design-tokens` deleted

Deleted 2026-07-17 (commit `db7b2e4c`), along with its wiring in 3 `package.json`, 3 `next.config.ts`, 3 `Dockerfile` and the CI build filter.

It had declared itself the "canonical source of truth" for a Cinzel + Inter design and was imported by **zero** source files. Proof it was dead: web-admin's emitted CSS was byte-identical before and after removal.

Worth remembering _why_ it was dangerous rather than merely dead: its radius scale used Tailwind **v3** naming (`sm: 0.125rem`, which is v4's `--radius-xs`), so anyone "reconnecting the canonical tokens" would have silently repainted ~857 `rounded-md` sites. A dead file that names itself canonical is worse than no file.

---

## D4 — `web-marketing` is still on the legacy design language

**Rule broken:** Typography (Fraunces + Geist). **Target: `web-marketing` adopts the Tournament Manual.**

`apps/web-marketing` is **Astro 7**, prerendered to `dist/` and served by Caddy. It imports no `@myclash/ui`, no `theme.css`, and hand-rolls its palette in `src/styles/base.css`. It runs **Cinzel + Cormorant Garamond** — the language the product left behind. This is the source of the "Cinzel + Inter" claim that survived in the docs for months.

Two specific defects on top of the font stack:

1. **Its brand red is the product's red corner** (and its danger value until 2026-11-17, D34). `--red: #dc2626` is used as the brand red while `--red-dark: #b91c1c` — the product's actual accent — is demoted to secondary. Inverted.
2. **~~Its body font never loaded.~~** — _fixed_: `family=Cormorant+Garant` was a typo for \*Cormorant **Garamond\*** in all 6 HTML files. Google Fonts **silently drops an unknown family from a combined request** rather than erroring — the request returned `HTTP 200` with only Cinzel (860 bytes vs 2136 after the fix), so there was no 400, no console error, and no signal of any kind. Cinzel loaded; the body copy fell back to Times for months. Corrected; kept here as context for the migration, and as a reminder that a font can be silently absent. Since the Astro rebuild (2026-08-11) neither the six HTML files nor the Google Fonts request exists: both faces are self-hosted through `@fontsource` (`src/styles/fonts.css`).

It shares the product palette **by copy, not by import**. Of the thirteen colours in `src/styles/base.css`, eleven have a value that also appears in `theme.css` (`#ffffff`, `#0f172a`, `#1e293b`, `#f1f5f9`, `#e2e8f0`, `#64748b`, `#b91c1c`, `#dc2626`, `#f59e0b`, `#1d4ed8`, `#3b82f6`); two match nothing there — `--blue-dark: #1e40af` and `--banner-navy: #010f33`, the navy baked into the banner image, added 2026-11-09. Sharing values is not sharing a system: when `theme.css` moves, this app does not follow.

**The technical excuse has expired.** This entry used to say the copying was "an accepted cost of having no build step". The Astro migration gave the app a real build, so importing `theme.css` is now ordinary work, not an architectural change.

**Why not fixed:** what is left is the brand decision, not the plumbing — migrating the public homepage's type is a visible change to `myclash.fr` and deserves its own review.

---

## D5 — style guide + component retokenization (mostly FIXED)

**Rule:** `/admin/design-system` is the executable contract, and shared components should read tokens not raw palette classes.

**FIXED (2026-07-17):**

- **The two wrong swatches.** `/admin/design-system` showed `border-slate-200 #E2E8F0` for hairlines (token is `#e7e5e4`) and `bg-red-800 #991B1B` for "primary CTA" (accent is `#b91c1c`). All the mappable swatches now render the semantic token utilities (`bg-background`, `text-foreground`, `border-border`, `text-muted`, `bg-accent`), so the two values are corrected and the page can no longer drift from a raw hex.
- **The dead hex fallbacks in `Button.tsx` and `Card.tsx`.** Removed. Every app imports `theme.css`, so `--color-*` is always defined and the fallbacks never fired — proven zero-op by a byte-level check that no `--color-*` value changed. Card's fallbacks were also actively _wrong_ (`#111827` for a `#ffffff` surface), a textbook declarations-rot case. The stale comments claiming web-admin/web-staff "keep the gray look via the fallbacks" went with them.
- **`AdminPageHeader` H1 + subtitle** retokenized to `text-foreground` / `text-foreground-secondary` (exact-value, zero render change).

**FIXED (2026-08-19) — the survivor this sweep missed:**

- **The three dead hex fallbacks in `EmptyState.tsx`.** Removed; it was the last
  `var(--color-*, #hex)` in `packages/ui`. Same proof as above: the built stylesheet defines
  `--color-muted` and `--color-foreground` in all three scopes, so `color:var(--color-muted,#4b5563)`
  and `.text-muted{color:var(--color-muted)}` compute identically — and the token utilities were
  already emitted in the same bundle, so no CSS was added either.

  All three values were wrong, in two directions at once. `#ffffff` stood in for
  `--color-foreground` — but `#ffffff` is `--color-surface`, the paper, so the fallback for the
  ink was the background; had it ever fired the title would have been white-on-white. That is the
  `Card.tsx` `#111827`-on-`#ffffff` defect mirrored. Worse, lines 23 and 28 gave **one token two
  different fallbacks** five lines apart, assuming opposite surfaces: `#4b5563` is dark ink for a
  light page, `#9ca3af` is light ink for a dark one. All three were `gray-*` in a `slate-*` system.

  **Why the 2026-07-17 sweep missed it, and why nothing has flagged it since.** That pass was
  scoped to the components `/admin/design-system` renders, and `EmptyState` is not on that page —
  the premise was right, the discovery surface was a file list. Nothing else could see it either:
  commit `23e9f9f5` had converted three _visible_ violations (`text-gray-600`, `text-white`,
  `text-gray-400`) into three _invisible_ ones, and `no-raw-palette-color` matches only
  `prefix-hue-number` class tokens while `check-design-drift` never opens a component file.

- **`EmptyState` now carries the FoilMark** its contract promised (fixed 2026-08-20). `DESIGN.md`
  had said "every zero-state. Carries the FoilMark" since the component was written, and for a year
  it carried none — the component and the contract disagreed, and no gate reads a prose claim about
  a component, so nothing could tell. It sits **above** the title, because `title` is the only
  required prop and a flourish below it dangles on the many call sites that pass a title alone. It
  is passed `text-muted` explicitly rather than taking FoilMark's `text-slate-300` default, which
  would have added 18 render sites to the open deviation below. A render test now holds all three
  facts, since prose plainly could not.

**FIXED (2026-10-15) — the `AdminPageHeader` eyebrow and border, on the operator's call:**

- The eyebrow is `text-accent`, as DESIGN.md's `page-header-eyebrow` says — not `text-accent-hover`,
  the value-exact `#991b1b`, because a hover colour used at rest is the wrong token. It moved
  red-800 → red-700 on the 22 web-admin pages that used the header then (27 files render it on
  2026-11-17). The rule under the header is
  `border-border` (`#e7e5e4`) instead of `border-slate-200` (`#e2e8f0`).
  `admin-page-header-render.test.tsx` holds both. The FoilMark's `text-slate-300` stays (below).

**Still open (each needs a value-shift decision or a new token — not a silent sweep):**

- **A second and a third `EmptyState` exist.** `web-admin` carries an unrelated local
  `function EmptyState()` at
  `apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/StandingsTab.tsx:495`. It is fully
  tokenized and imports nothing from `@myclash/ui` — a name collision rather than a divergent copy,
  but one grep away from being mistaken for the shared component, and it did not gain the FoilMark.
  `web-staff` has the same collision at `apps/web-staff/app/desk/page.tsx:250`.

- **`FoilMark` / FormField input border** `text-slate-300` / `border-slate-300` (`#cbd5e1`): **no token has this value.** The system has no control-border tier distinct from the card hairline, and no placeholder tier (`slate-400`). Adding those tiers is a token decision.
- **`FormField`**: its error text is `text-red-700` = accent-exact, but an error should be `text-danger` — the value-matching token and the correct token disagree. Wants the semantic fix, not a value-preserving swap. This entry used to say the design-system showcase was the component's only consumer. Since 2026-11-10 (`cc4018137`) it is shipped chrome in the organiser's Workshops screens — `InstructorDetailsPanel.tsx:100,110`, `RosterMessage.tsx:29,35` and `RosterAddPerson.tsx:49` under `apps/web-admin/app/org/[slug]/events/[eventId]/workshops/` — so the accent-red error text and the raw `slate-*` border and label now reach an organiser.
- **`/admin/design-system` is a partial specimen, and part of it can still rot.** It renders six
  primitives (`AdminPageHeader`, `StatusBadge`, `DataTable`, `Button`, `FormField`, `FoilMark`) of
  the 55 component files in `packages/ui/src/components` — no `Modal`, `EmptyState`, `Card` or
  scoreboard.
  Three of its swatches are raw palette classes with no token behind them (`bg-amber-50`,
  `bg-indigo-50`, `bg-green-50`, `page.tsx:110-124`), its two FoilMark colour examples are
  `text-red-800` and `text-amber-700` (`:165-166`), every swatch's hex label is a hand-typed string
  (`:81-147`), and `StatusBadge` is shown only through the legacy `variant` prop (`:212`). The
  2026-07-17 fix above put the swatch _fills_ on tokens; the labels beside them are still prose.
- **`Button` status variants** (`danger`, `gold`, secondary, …) stay raw **on purpose**: they render in web-staff (dark), and a solid `bg-danger`/`bg-gold` fill there was tuned for _text_ contrast, so tokenizing the fill naively would break legibility. Needs status-fill tokens distinct from status-text.
- ~~**`Button.tsx:69` `ring-offset-gray-900`**~~ **FIXED (2026-07-27)** — it was painting a near-black halo around every focused button on the light admin pages. Now `ring-offset-background`, which tracks the `[data-theme]` scope instead of assuming one. The ring hue went `ring-amber-400` → `ring-gold` in the same pass: identical on dark, a deeper amber-500 on light where it needs the contrast.
- **`Card` `CardBody`** the removed `#d1d5db` fallback shows the original intent was a _muted_ body; the var choice (`--color-foreground`) silently flattened title and body to one colour. `CardBody` should probably be `foreground-secondary` — a deliberate (visible) change, so deferred.

---

## D6 — Three input styles

**Rule broken:** Components — build from `@myclash/ui`.

| Style                     | What                                                                                                                                                                | Where                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `@myclash/ui` `Input`     | **Dark** field (`bg-gray-900 border-gray-700 text-white`, red-600 focus). Uses `gray-*` while the whole system uses `slate-*`/`stone-*`. Predates the token system. | **Nowhere.** Exported from the barrel, rendered by no app or package (2026-11-17). This row used to say "~15 uses in light admin pages". |
| `@myclash/ui` `FormField` | The light admin-red field. The intended one.                                                                                                                        | The design-system page and three organiser Workshops panels (five call sites; see D5). Every other admin form hand-rolls its field.      |
| raw tokenized inputs      | No shared component; hand-rolled `border border-border bg-surface … focus:ring-accent`                                                                              | `/me` pages, e.g. `apps/web-public/app/me/events/[eventSlug]/workshops/page.tsx:378`, and the admin forms `FormField` never reached      |

The third row keeps growing, which is the cost of leaving the decision open. Each of these is a
field helper local to one feature, written since the entry was opened:

- **FightBook's `Field` + `inputClass`** — `apps/web-public/src/components/fightbook/AskSparFields.tsx:8-24`
  (`dafb865aa`, 2026-11-12), reused by `AskSparDialog`, `AllOfFightBook`, `FindTab`,
  `PostOpenCall`, `QrScan` and `FightBookSettingsPanel`. Its label is
  `text-sm font-semibold text-foreground`: as loud as the value, which breaks "the label is the
  smallest text on screen".
- **The instructor's "my details"** — `apps/web-public/app/me/instructor/MyDetailsPanel.tsx:21`,
  a local `INPUT` on `bg-background`.
- **The runtime-health alert settings** —
  `apps/web-admin/app/admin/system-versions/RuntimeHealthCard.tsx:444`, a local `inputClass`.

**Why not fixed:** needs a real decision (extend `FormField` to cover dark and the public app? retire `Input`?), not a sweep.

---

## D7 — the kiosk stage is a token (mostly FIXED; `TVScoreboard` is not on it)

Added `--color-stage` (`#030712`) + `--color-stage-foreground`, and migrated three projector surfaces off `bg-gray-950`:

- `apps/web-admin/app/display/layout.tsx`
- `apps/web-public/app/e/[eventSlug]/match/[matchId]/display/display-view.tsx`
- `packages/ui/src/components/LiceWaitingDisplay.tsx` (the lice route renders this bare when idle)

The stage is deliberately deeper than `dark-background` (`#0f172a`) so the corner colours carry across a hall, and it is scope-independent — always this near-black on any theme, which is why it is its own token rather than a dark-scope override.

**Still open — this entry used to say "all the projector surfaces", and that was never true.**
`packages/ui/src/components/TVScoreboard.tsx` paints `bg-gray-950 text-white` on its root (`:298`)
and on its two full-screen states, loading and error (`:215`, `:230`), and has done since it was
written (`03a62565a`, 2026-06-07). `gray-950` is `#030712`, the token's own value, so a hall sees
no difference today — the two wrappers that host it are on `bg-stage` and the component paints the
same colour over them. It is parity by coincidence, not by token: move `--color-stage` and the
scoreboard stays behind. The file is on the `packages/ui` raw-palette exemption list (D21), which is
why no lint says so.

The light strips on the stage are raw palette too: the scoreboard's header and footer
(`TVScoreboard.tsx:386`, `:820`) and the waiting screen's header (`LiceWaitingDisplay.tsx:68`) are
`bg-white` with `slate-*` ink, not `bg-surface` under a light scope.

**Why not fixed:** found in the 2026-11-17 docs sweep; not fixed in that sweep.

**Bug fixed in passing:** `LiceWaitingDisplay` had the stage background but was **missing `cursor-none`** — so a mouse pointer sat visible on the projection during the between-matches waiting state, which is the state a hall screen sits in longest. The two `<div>` wrappers had `cursor-none`; the component everyone forgot did not. Added.

---

## D8 — z-index migration (mostly done; a deliberate tail remains)

**FIXED (2026-07-17):** an audit classified all 82 bare `z-*` sites by what each element _is_. The **35 unambiguous, page-level ones** now use the named tokens: dialog backdrops / popovers → `z-overlay`, the shells' sidebars → `z-sidebar` and headers → `z-header`, sticky sub-headers → `z-sticky`, skip-links → `z-skip-link`.

32 of those were **value-preserving renames** (`z-overlay`=50, `z-sidebar`=40, `z-header`=30, `z-sticky`=20, `z-raised`=10 — same numbers), so stacking order did not move; verified every named utility emits its expected value in the built CSS. The 3 skip-links were the one real change: `focus:z-50` → `z-skip-link` (50→60), a correction so a focused skip-link sits **above** an open modal instead of tying with it (the two shells were already at 60).

**Left on bare numbers on purpose (~47 sites then):** private, self-contained stacking ladders where a page-level name would *mis*describe the element. The largest is the schedule grid: its `z-10` time-label column < `z-20` resize handles < `z-30` venue header cells is an internal ladder, not the page's header/sticky layers. (It lived in `grid.tsx` when this was written; the grid has since been split, and the ladder is now in `BlockGridView.tsx` and the `Detailed*.tsx` files beside it — 19 bare sites between them.) Renaming those to `z-header`/`z-sticky` would be value-identical but semantically wrong, and would invite someone to "fix" the grid against the page's z-order. Also left: a handful of dropdown menus rendered _inside_ an already-stacked fixed parent (their number only competes with a sibling backdrop, so the page-level token doesn't apply). New code should use the named tokens; a number that is part of a local ladder is fine.

**Recount, 2026-11-17:** 39 named uses and 60 bare `z-10`…`z-60` uses across the three apps and `packages/ui` (tests excluded). The bare tail grew by about thirteen, and most of the growth is new local ladders of the kind described above: the organiser's Workshops board (`WorkshopScheduleBoard.tsx:749,822,838,936,1015`), the public Workshop grid (`WorkshopScheduleGrid.tsx:125,144,179`) and the live control room's rows (`BoardRowView.tsx`, 8 sites). One new site is **not** a ladder and should have been a token: the fixed toast on the public Workshop page, `apps/web-public/app/e/[eventSlug]/w/[workshopSlug]/page.tsx:234` (`z-50`) — see D23. The comment above `--z-index-*` in `theme.css` still says the migration "needs an audit"; the audit is the one recorded here.

**Latent bug the audit found — FIXED (2026-07-27):** `BulkActionBar.tsx` (`z-30`, top-sticky; now line 51) tied with the fixed shell header (also `z-30`) and, being later in the DOM, painted over it when pinned. Now `z-sticky` (20), which is what a sticky sub-header is: it slides **under** the page header. The `bottom-floating` variant took the value-preserving rename `z-40` → `z-sidebar` at the same time.

Radius is **not** a deviation: `rounded-md/lg/xl/full` is the vocabulary, deliberately un-aliased (see `DESIGN.md` → Shapes).

---

## D10 — One URL serves two languages, so only one is indexable

**Rule broken:** every user-facing string is available in `en` and `fr` — but only one of them can be found.

`web-public` resolves the locale per request from the `mc_locale` cookie, then `Accept-Language`, then the default. There is no locale in the path and no locale in the query, so `https://app.${DOMAIN}/e/lyon-open-2026` is **one URL that renders two different documents**.

Publishing `sitemap.ts` and `robots.ts` makes this consequential rather than theoretical:

- A crawler has no cookie and sends whatever `Accept-Language` it likes, so which language gets indexed is not a decision anyone made.
- There is no second URL to point `<link rel="alternate" hreflang>` at, so the tag cannot be emitted at all — the standard fix is unavailable, not merely unimplemented.
- Every entry in the sitemap has this property. The French half of the content is effectively unsearchable, which for a French-speaking HEMA scene is the wrong half.

Note this is **not** a `metadataBase` or canonical bug: those are correct, and the canonical deliberately points at the bare path so filtered views do not split ranking. The problem is one level up — there is only one path to be canonical about.

**Why not fixed:** the fix is locale-prefixed routes (`/fr/e/...`, `/en/e/...`) or a locale subdomain, either of which moves every URL this app has ever emitted and needs redirects for the old ones. That is its own slice, and it should happen before the sitemap has been indexed long enough for the moves to cost ranking — not as a rider on the commit that publishes it.

---

## D11 — FIXED: the event-tint spec outlived the feature

**Fixed 2026-08-20 by deleting the specification, not by building the producer.** `DESIGN.md` and
`docs/design/web-public.md` both specified the tint as `--color-accent: var(--event-primary, #b91c1c)`.
Nothing set `--event-primary`.

The reason matters, because the obvious reading is the wrong one. This was not an unbuilt feature
waiting for someone. Migration **0086 retired per-event colour deliberately** and says so: the
pickers were "write-only knobs" whose variables "weren't actually read by any component", and "the
unified MyClash design … governs both apps from one set of design tokens". It names what carries
per-event identity instead — `events.logo_url`, `themes.hero_image_url`, `organizations.brand_color`
for the landing card, and `tournaments.color` inside the event subtree. Commit `02ed0977` then
deleted the producer block. The spec simply outlived the deletion by about three months.

**A spec that outlives its feature grows consumers.** That is the lesson worth the entry. While the
paragraph stood, two rounds of pages inlined an `--event-*` variable whose fallback was therefore
the only colour that ever rendered:

- `var(--event-primary, #c0392b)` on 10 sites — the fallback was the shipped accent (D2, fixed
  2026-07-17).
- `var(--event-accent, #f59e0b)` on 5 sites / 9 headings — the same disease one variable name over,
  so D2's by-name sweep never matched it. It shipped **raw gold at 2.06:1 on `text-xs` headings**,
  an AA failure on three public pages, for roughly eleven weeks. Fixed 2026-08-19.

Both readings of the paragraph were dangerous. Read as intent, it invited someone to build a
retired feature. Read as description, it invited exactly the two inlining bugs above.

**Considered and rejected:** pointing the tint at `organizations.brand_color`, which is already on
the wire — the event-by-slug query returns its row unprojected, and the public Event header already
calls that endpoint, so it would have cost about three edits. It is a free `TEXT` column with **no
contrast constraint**, rendered today only as a decorative stripe. Promoting it to `--color-accent`
would put an arbitrary hex behind headings and buttons, which is the defect D11 and D12 both were.
If it is ever promoted, it needs a contrast guard first.

`pnpm quality:css-vars` now rejects the shape that made this expensive, so a third round cannot
reach `main` the way the first two did.

---

## D12 — FIXED: the tournament's raw colour is a fill, not ink

**Fixed 2026-08-20.** The tournament page painted its `<h1>` with `colorTokenToHex(tournamentColor)`
— the raw hue. At `text-2xl` bold that is large text, needing only 3:1, and **7 of the 13
configurable colours missed even that**:

| silver | gold | yellow | amber | green | teal | orange |
| ------ | ---- | ------ | ----- | ----- | ---- | ------ |
| 1.42   | 1.47 | 1.84   | 2.06  | 2.18  | 2.38 | 2.68   |

The title now reads `text-foreground`. **The colour did not move to a darker shade — it moved to
the bar**, the `aria-hidden` fill beside the heading that already carried it. That is the general
rule this entry exists to leave behind: a tournament's hue is safe as a fill and unsafe as ink, so
give it the stripe and let the words stay legible. The `/me` twin had shipped it that way all
along, which is what settled it.

`tintTextClassFor` was the other candidate — all 14 of its `-700`/`-800`/`-900` shades clear 4.5:1
(worst: green-700 at 4.80:1) and the stats headings did move onto it. It was rejected **here**
because `colorTokenToHex` and `ColorToken` cover different sets: a tournament may be configured
`grey`, `brown` or `pink`, none of which is a token, so all three resolve to neutral slate through
`asColorToken`. Tinting the title would have taken the hue off those three tournaments' own name.
On a section heading that is a fair trade; on the title, it is not.

---

> **D13 to D25 were found in the docs sweep of 2026-11-17**, which compared `DESIGN.md` with the
> code and fixed none of what it found. Each shares the same "why not fixed": it was found in that
> sweep and not fixed in it. Line numbers are as of that day.

## D13 — FIXED: the `ghost` button was white ink on light pages

**Rule broken:** Colours — every colour pair clears WCAG AA for text; components follow the scope
they sit in.

**Fixed on 2026-11-17, in the component.** `ghost` now spends the scope's own ink at the opacity
steps it had: `text-foreground border-foreground/20 hover:border-foreground/40
hover:bg-foreground/10 active:bg-foreground/20` (`packages/ui/src/components/Button.tsx`). On the
dark sign-in panels it reads as before (`#f1f5f9` where it was `#ffffff`); on a light surface it is
dark text in a hairline. No call site changed. `button-ghost-render.test.tsx` holds the variant on
tokens, and `theme-ink-contrast.test.ts` holds the contrast of that ink on every surface.

**What it was.** Rendered and measured on 2026-11-17 (a static page built from the classes and
each app's production stylesheet, in Chromium, not the running app): the label and the border both
painted `#ffffff` on `#ffffff`, a contrast of 1:1, on the admin photo tile, on a FightBook card and
in a FightBook dialog. The button could not be seen at all; it still took its place in the row and
still took a click. The variant was `text-white border-white/20 hover:bg-white/10`, raw white
whatever the scope: a quiet outlined action on the dark auth panels, and white text inside a white
hairline on `#ffffff` or `#fafaf9`.

It was used on light surfaces in two apps:

- **web-admin:** Delete on each photo of the moderation queue
  (`src/components/photos/PhotoQueue.tsx:207`, inside the `bg-surface` tile at `:132`; `ea20edef8`,
  2026-11-07), "New link" on the organiser's Photos page
  (`app/org/[slug]/events/[eventId]/photos/PhotoLinkPanel.tsx:101`) and "Details" in the audit log
  (`src/components/PayloadCell.tsx:160`).
- **web-public**, on the light content of `/me` and in the light `Modal`: FightBook's
  `InboxTab.tsx:79,130`, `OpenCallCards.tsx:117`, `QrPanel.tsx:30,38`, `QrScan.tsx:146`,
  `QrTools.tsx:35,38` and `SparFlag.tsx:118` under `app/me/fightbook/`,
  `src/components/fightbook/AskSparDialog.tsx:252`, and "Remove photo" at
  `app/profile/fighter/FighterProfileClient.tsx:828`.

**Still open, beside it:** in the same photo queue, Approve and Keep use `secondary`, a raw
`bg-blue-700` (`PhotoQueue.tsx:190,200`), on the surface whose accent is "always red"
(`web-admin.md`).

---

## D14 — FIXED: the display wall wrote page ink on the stage

**Rule broken:** Colours — `stage` takes `stage-foreground`; the scopes decide the ink.

**Fixed on 2026-11-17.** The wall writes the stage ink: `text-stage-foreground` for the piste name
and the bout line, `text-stage-foreground/60` for the quiet cells, the group label and the
messages, `border-stage-foreground/30` for the row divider (`WallRow.tsx`, `LiveWall.tsx`).
`wall-ink.test.tsx` holds both files free of page ink, and `theme-ink-contrast.test.ts` measures
the two inks on the stage. A `data-theme="dark"` on the wall's root was the smaller change and was
not taken: the stage is scope-independent by rule, and under a dark scope the row divider drops to
about 1.2:1.

**What it was.** Rendered and measured on 2026-11-17 (a static page built from the classes and
web-admin's production stylesheet, in Chromium at 1920×1080, not the running app): the piste name
and the bout line (fighters and score) painted `#0f172a` on `#030712`, a contrast of 1.13:1, and
could not be read. The muted cells (status, clock, group label) reached 4.23:1 and the warning cell
4.01:1; the status dots showed. So the wall showed which piste was in trouble and not which piste
it was. The organiser's projector wall, `/display/wall/[eventId]` in web-admin, sits inside
`app/display/layout.tsx:14`, which paints `bg-stage` (`#030712`) and sets no `data-theme`. Its rows
used the page inks, which with no dark scope above them resolve to the base values, `#0f172a` and
`#64748b`, on a near-black stage. It had been like this since the wall was written (`62e2fb281`,
2026-08-06).

**Still open, beside it:** the "behind" cell keeps `text-warning`, 4.01:1 on the stage at the
wall's small meta size.

---

## D15 — shadows above the `shadow-sm` ceiling

**Rule broken:** Elevation & Depth — "`shadow-sm` is the ceiling"; Do's and Don'ts — "Don't exceed
`shadow-sm`".

44 class sites carry `shadow-md`, `-lg`, `-xl`, `-2xl` or an arbitrary `shadow-[…]`, against 194
`shadow-sm`. Four of the 44 are not elevation at all: an `inset` shadow used as a hairline that
survives `position: sticky` (`persons/page.tsx:1516,1613`, `pools/_tabs/MatchesTab.tsx:38,39`).
Three more are the skip link of each app's `layout.tsx`, visible only on focus. The other 37 lift
something off the paper:

- **`packages/ui`:** `Modal.tsx:87` (xl), `AuthPanel.tsx:145` (2xl), `BulkActionBar.tsx:51,52`
  (md, lg), `CsvExportMenu.tsx:171` (xl), `HelpTooltip.tsx:49`, `ClubCombobox.tsx:182`,
  `CountryCombobox.tsx:141` (lg), `LiceWaitingDisplay.tsx:86` (2xl), `bracket/MatchCard.tsx:148`
  (md), and the gold glow on `Button.tsx:33`.
- **Shells and drawers:** `SuperAdminShell.tsx:285,433`, `OrganizerAdminShell.tsx:315,579`,
  `WorkspaceSwitcher.tsx:128`, `PublicPersonalShell.tsx:226,308`,
  `MatchCorrectionsDrawer.tsx:214`, `MatchResultOverlay.tsx:337`, `PasswordPanel.tsx:14`,
  `DisplayControls.tsx:109`.
- **Popovers and floating panels in web-admin:** `admin/fighters/page.tsx:877`,
  `admin/hema-ratings/page.tsx:571`, `admin/users/AccountsTable.tsx:43`, `IsoDatePicker.tsx:94`,
  `standings/StandingsHeaderCell.tsx:78`, and under the Event: `referees/page.tsx:1992`,
  `referees/_components/SkillCatalog.tsx:320`, `referees/_components/StaffingTab.tsx:507`,
  `schedule/grid.tsx:2417`, `schedule/DetailedRunHeaders.tsx:107`,
  `schedule/DetailedGridView.tsx:147` (a red glow on the "now" line),
  `workshops/WorkshopScheduleBoard.tsx:749`.
- **web-public:** `PoolsCompositionView.tsx:165`, `PersonalSpaceDashboard.tsx:462`, and the toast
  of D23.

**Why it matters:** a dialog, a drawer or a popover over the page is the one place a shadow has a
case. If that case is accepted, `DESIGN.md` should say so and name the layers; today it says "paper
doesn't float" and the shared `Modal` floats.

---

## D16 — the auth panel's glow

**Rule broken:** Overview — "uncoated stock means nothing floats", no glass, no glow; Colours —
status inks are for badges and alerts only.

`packages/ui/src/components/AuthPanel.tsx:147` fills the hero half of every sign-in page with two
radial gradients over a linear one: `--color-accent` at 35% and `--color-warning` at 24%. The second
is a status colour used as decoration, and the whole is the glow the Overview rules out. The panel
around it is `shadow-2xl` (D15). It is the first screen of web-admin and of the personal space.

---

## D17 — page titles outside the display face

**Rule broken:** Type — "exactly one H1 on a page, in `font-display`"; "don't drop `font-display`
on dark pages".

Seventeen `<h1>` elements carry no `font-display` (single-line elements only; a few public pages
split the tag over several lines and were not counted):

- **`packages/ui`:** `AuthPanel.tsx:158` (`text-4xl font-black`), the title of every sign-in page —
  exactly the dark-page case `web-public.md` forbids; `MatchScoreboard.tsx:223`.
- **web-public:** `src/components/PasswordPanel.tsx:15`, `app/auth/oauth/callback/page.tsx:172,193`,
  `app/auth/signed-in/page.tsx:29`, `src/components/NotFoundCard.tsx:62`,
  `src/components/RouteErrorCard.tsx:36`.
- **web-staff:** `app/login/page.tsx:59`, `app/lices/page.tsx:183,204`,
  `app/lices/[liceId]/_components/LiceHeader.tsx:25`, `app/offline/page.tsx:11`,
  `src/components/MatchView.tsx:1069,1097`.
- **web-admin:** `app/admin/error.tsx:23`, `app/org/[slug]/error.tsx:23`.

The staff desks, gear check, photos and scan screens do carry it, so the app is split down the
middle rather than deliberately plain.

---

## D18 — `Button` and the field are not built as specified

**Rule broken:** Shapes — "`rounded-md`: controls — buttons, inputs, selects"; Components — the
`Button` variants; the front matter's `components.button-*` and `components.input`.

Four places where `DESIGN.md` specifies a control and `packages/ui` builds another:

- **Radius.** Only the `sm` size is `rounded-md`. The default `md` is `rounded-lg` and `lg` / `xl`
  are `rounded-xl` (`Button.tsx:43-46`), so nearly every button in the product wears the panel or
  the card radius.
- **There is no `strong` variant.** `DESIGN.md` names it twice — "`strong` is the dark-neutral
  alternative when a page's accent is already spent", "reach for `strong`" — and specifies
  `button-strong`. `ButtonVariant` is `primary | secondary | ghost | danger | gold | back | cancel |
outline` (`Button.tsx:3-4`). The `strong` _tokens_ exist and are used at call sites
  (`bg-strong text-strong-foreground`); the variant was never written.
- **Four variants nobody specified.** `secondary` (raw blue-700), `ghost` (raw white, D13), `back`
  and `cancel` (raw slate) are in the code and were absent from `DESIGN.md` until the 2026-11-17
  sweep named them. `gold` is described there and has no call site.
- **The 44px field.** `components.input` gives the field `height: {spacing.touch-min}`. `FormField`
  is `px-3 py-2 text-sm` with no minimum height (`FormField.tsx:48-53`), and `theme.css` defines no
  `--spacing-touch-min`: the staff app writes the literal `min-h-[44px]` instead (60 sites).

**Why not a one-line fix:** the radius touches every button on every surface, and the variant list
is a decision about which neutral the system keeps (`strong`, `outline`, `back` and `cancel` are
four answers to one question).

---

## D19 — a status ink used as decoration

**Rule broken:** Colours — "`danger` / `success` / `warning` / `info` are badge and alert inks".

FightBook's favourite heart is `text-danger` when it is on
(`apps/web-public/src/components/fightbook/FavouriteHeart.tsx:75`, `0d6509612`, 2026-11-12). A
favourite is not an error. The same file uses `text-danger` correctly a few lines lower, on the
refusal message, which is what makes the first one read as a mistake rather than a choice.

---

## D20 — a tooltip on a screen with no pointer

**Rule broken:** `display-kiosk.md` — "don't add a hover state, a tooltip, or anything requiring a
pointer".

`packages/ui/src/components/TvProtestChip.tsx:37` puts a `title=` on the protest chip of the TV
scoreboard (`bd9502771`, 2026-11-17). The stage is `cursor-none`; nobody can hover it. The chip
shows a hand and a number, and the sentence that says what they mean exists only in that tooltip.
A screen reader does read a `title`, so it is not worthless — but for a spectator the explanation
is unreachable.

---

## D21 — 26 files of `packages/ui` are exempt from the raw-palette lint

**Rule broken:** Components — shared components read tokens, not raw palette classes (D5).

`packages/ui/eslint.config.mjs:31-58` lists 26 files in `PRE_EXISTING_PALETTE_DEBT`, a ratchet that
"may only shrink": `no-raw-palette-color` does not run on them. D5 and D6 name five of them
(`Button`, `FormField`, `FoilMark`, `AdminPageHeader`, `Input`). The other 21 are open debt this register did
not record: `TVScoreboard`, `MatchScoreboard`, `MatchTimeline`, `LiceWaitingDisplay`, `BracketView`,
`bracket/MatchCard`, `bracket/MedalPodium`, `bout-flow-geometry.ts`, `AiKeyFormDialog`,
`BulkActionBar`, `CountryCombobox`, `Divider`, `HelpTooltip`, `MaintenanceBanner`, `MetricCard`,
`Pill`, `RowActionButton`, `SortableHeader`, `StatusHelp`, `Toast` and `utils/status-pill.ts`.

The last one matters most: `status-pill.ts` is where `StatusBadge` gets every colour it paints, so
the chip the whole product uses for status is on raw palette classes chosen in JavaScript, not on
the status tokens. That is also why it needs a `surface` prop — it cannot follow the `[data-theme]`
cascade.

---

## D22 — page containers off the four widths

**Rule broken:** Layout — "pick exactly one container width per page", from `max-w-[110rem]`,
`max-w-7xl`, `max-w-6xl`, `max-w-2xl`.

At least 23 pages open a container at `max-w-3xl`, `max-w-4xl` or `max-w-5xl` (counted in
`page.tsx` files only):

- **web-admin, 20 pages.** Under `/admin`: `ai`, `ai/keys`, `ai/models`, `weapons`, `leagues/new`,
  `leagues/[id]/edit`, `organizations/[id]`, `rulesets/penalty/new`, `rulesets/scoring/new`. Under
  `/org/[slug]`: `settings`, `settings/ai`, `rulesets/penalty/new`, `rulesets/scoring/new`,
  `rulesets/scoring/[id]/edit`, and under the Event `hema-ratings`, `matches/[matchId]`,
  `notifications`, `penalties`, `print`, `tournaments/[tournamentId]/settings`. Several of them also
  pad with `p-8` instead of the console's `px-6 py-8 lg:px-8`.
- **web-public, 3 pages:** the photos page (`e/[eventSlug]/photos/page.tsx:38`, `max-w-5xl`), the
  display hub (`e/[eventSlug]/display/page.tsx:97`, `max-w-4xl`) and the tournaments list
  (`e/[eventSlug]/tournaments/page.tsx:32`, `max-w-5xl lg:max-w-6xl`).

Most of the admin ones are forms and settings, where `max-w-[110rem]` would be wrong and
`max-w-2xl` too narrow. That is a sign the scale is missing a step, not only that the pages are
wrong.

---

## D23 — hand-rolled copies of shared primitives

**Rule broken:** Components — build from `@myclash/ui`.

- **A toast.** The public Workshop page draws its own:
  `apps/web-public/app/e/[eventSlug]/w/[workshopSlug]/page.tsx:234`, a fixed `z-50` `shadow-lg`
  chip, where `useToast` exists. It also breaks D8 (a bare number where `z-overlay` belongs) and
  D15.
- **A status pill.** `apps/web-admin/app/admin/system-versions/RuntimeHealthCard.tsx:110` defines a
  local `StatusPill`. It is tokenized, and it is a second owner for what `StatusBadge` does.
- **Field helpers** — three of them, listed under D6.
- **`EmptyState`** — two local functions of that name, listed under D5.

---

## D24 — motion without a reduced-motion guard, and keyframes only one app defines

**Rule broken:** Layout and motion — "wrap every animation in a `prefers-reduced-motion` guard".

Two separate things.

**Unguarded utilities.** 43 elements use Tailwind's `animate-pulse` or `animate-spin` with no
`motion-safe:` prefix; 7 of them add `motion-reduce:animate-none`, which leaves about 36 that keep
moving for a user who asked for less motion. No app's stylesheet has a global guard. On the scoring
pad they are the clock and the centre controls at time-up (`MatchClock.tsx:178`,
`ScoringCenterControls.tsx:332`) and the result overlay (`MatchResultOverlay.tsx:155`) — three
pulses whose whole job is to be noticed in peripheral vision, which is a case for an exception
written down, not for silence.

**Keyframes that exist in one app.** The shared `Modal`, `AiKeyFormDialog`, `Toast` and
`BulkActionBar` put `dialog-card-enter`, `toast-enter` and `bulk-bar-enter` on their roots. Those
classes and their `@keyframes` are defined only in `apps/web-admin/src/styles/globals.css:46-110`
(with a reduced-motion guard). In web-public and web-staff the class names match nothing, so the
same component enters with motion in one app and without it in the two others. Harmless to look at,
and exactly the `var(--event-primary, …)` shape: a shared component depending on something only one
consumer produces.

---

## D25 — raw hex in app code

**Rule broken:** Colour — "don't write a raw hex in app code. The only hex lives in
`packages/ui/src/theme.css`".

Chrome painted with a literal, all in the organiser's schedule grid, where the lines are inline
`style` objects that no class lint reads:

- `schedule/BlockGridView.tsx:477,489,499` — slot rules `#f8fafc`, `#e5e7eb`, `#f1f5f9`; `:851` —
  the "now" line, `#ef4444`.
- `schedule/DetailedSlotCells.tsx:55,75` — hour rules `#d1d5db`.
- `schedule/DetailedGridView.tsx:147` — `rgba(220,38,38,0.6)` in a glow (also D15).

Not counted, because they are data rather than chrome: the swatch lists an organiser picks a
colour from (`ColorSwatchPicker.tsx`, `workshops/page.tsx:1897`), the default colour of a new piste
(`schedule/grid.tsx:612`), the hand-typed hex labels of `/admin/design-system`, and the stylesheets
of the printable HTML exports.

---

> **D26 onward were found in the readability audit of 2026-11-17**, which read the fighter app, the
> organiser's console and `packages/ui` for ink that does not match its surface. web-staff was not
> read.

## D26 — FIXED: a fill in the organiser's colour wrote a fixed white

**Rule broken:** Colours — every colour pair clears WCAG AA for text.

**Fixed on 2026-11-17.** A solid fill in a Tournament's colour now brings its ink:
`accentInkClassFor(token)` sits beside `accentClassFor(token)` in
`packages/ui/src/utils/color-token.ts`. It is white on red, blue, green, purple, black, violet,
teal and bronze, and `text-slate-900` on yellow, white, gold, silver, slate, amber and orange. A
fill in a free hex takes `inkOnHex(hex)` (`side-color.ts`), white or black by contrast.
`theme-ink-contrast.test.ts` measures all fifteen pairs; the lowest are green (4.95:1) and orange
(4.98:1).

**What it was.** Six places filled a chip with a colour the organiser picks and wrote `text-white`
on it whatever the colour. Rendered and measured on 2026-11-17 (a static page built from the
classes and web-admin's production stylesheet, in Chromium, not the running app), white on the
fill is:

| white | silver | yellow | gold | slate | amber | orange |
| ----- | ------ | ------ | ---- | ----- | ----- | ------ |
| 1.10  | 1.49   | 1.57   | 1.72 | 2.63  | 3.20  | 3.58   |

The first four cannot be read at all. The places:

- **web-public:** the selected half of the "Overall / By pool" toggle on a Tournament's Standings
  (`t/[tournamentSlug]/StandingsView.tsx`); the rank 1 and rank 2 discs, the champion's "1" and the
  "Season finalized" pill of a league (`leagues/[slug]/StandingsGroups.tsx`, `page.tsx`).
- **web-admin:** the strip above each run of the detailed schedule
  (`schedule/DetailedRunHeaders.tsx`); the "Live" pill of the brand preview on the organisation's
  dashboard (`org/[slug]/page.tsx`), filled with the organisation's own hex.
- **both:** the winner's score chip of a bracket card (`packages/ui` `bracket/MatchCard.tsx`).

`grey`, `brown` and `pink` side colours are not tokens (D12): they resolve to the neutral slate
fill, where white was 2.63:1.

**The rule this leaves behind:** D12 said a Tournament's hue is safe as a fill and unsafe as ink.
The other half is that the fill does not get a fixed ink either. Take both from `color-token.ts`.

---

## D27 — FIXED: three inks on a surface they were not made for

**Rule broken:** Colours — every colour pair clears WCAG AA for text; components follow the scope
they sit in.

**Fixed on 2026-11-17.** Rendered and measured that day, before and after (a static page built from
the classes and web-admin's production stylesheet, in Chromium, not the running app):

| Where                                                    | It was                                   | Ratio | It is                               | Ratio |
| -------------------------------------------------------- | ---------------------------------------- | ----- | ----------------------------------- | ----- |
| Sign-in panel, the link to the other app (organiser)     | `text-accent`, red on the dark card      | 2.26  | `text-foreground`, underlined       | 13.35 |
| The same link on the personal panel                      | `text-accent`, blue on the dark card     | 2.18  | the same                            | 13.35 |
| Initials disc of a person with no photo, on a light page | `bg-accent text-foreground`, dark on red | 2.76  | `bg-strong text-strong-foreground`  | 17.85 |
| The same disc in the dark sidebar of `/me`               | light on blue, about 6:1                 | —     | the `strong` pair, inverted         | 14.48 |
| Projector popup, "Swap sides" and "Fullscreen"           | `bg-black/40 text-white/70` over white   | 2.16  | `bg-stage/80 text-stage-foreground` | 11.58 |

- **The accent is a fill, not an ink, in a dark scope.** `[data-theme='dark']` lightens every status
  colour and does not touch `--color-accent`, because `bg-accent` carries white text in both scopes.
  So `text-accent` on a dark card is the light-page red or blue on slate-800. The cross-app link
  (`AuthPanel.tsx`, `authAltLinkClass`) and the hover of the consent line's two links
  (`LegalConsent.tsx`, one copy in each app) both did it.
- **The initials disc** (`Avatar.tsx`) painted the accent and wrote the page ink on it. Its comment
  said "neutral, not red" from the day it was written. It was used on light pages on the fighter
  directory, the follows, FightBook and a Workshop's instructor.
- **The stage toggles** (`web-admin/app/display/[matchId]/page.tsx`) float over the top-left corner
  of the popup, which is `TVScoreboard`'s white header. A thin black wash there is a mid grey.

**Still open, beside it:** `LegalConsent.tsx` is two identical files, one in each app (D23's class).
Any other `text-accent` placed in a dark scope has the same 2.2:1; none was found in the sidebars,
the drawers or the password panels.

---

## D28 — FIXED: the Live board faded the pistes that were fine

**Rule broken:** Colours — every colour pair clears WCAG AA for text; a class names a token that
exists.

**Fixed on 2026-11-17.** Two faults on the organiser's Live board
(`/org/[slug]/events/[eventId]/live`), the screen read all day during an Event.

- **A healthy piste was drawn at 60%** (`BoardRowView.tsx`, and the folded list on a phone in
  `LiveBoard.tsx`), so the piste in trouble would stand out. Most pistes are healthy most of the
  day. Rendered and measured on 2026-11-17 (a static page from web-admin's production stylesheet,
  in Chromium), the grey cells of a healthy row — status, scorer, "synced", next bout — were
  2.25:1, and the names 4.62:1. They are now 4.56:1 and 17.09:1. The state dot, the warning ink and
  the alert button already mark a piste in trouble; the fade added nothing they did not.
- **`bg-surface-2` is not a token.** The open row's panel (`BoardRowDetail.tsx`), the row's hover
  (`BoardRowView.tsx`) and the actions' hover (`BoardRowActions.tsx`) named it. It compiled to
  nothing: measured, the panel's background was transparent. The panel is now
  `border border-border bg-surface`; the hovers are `hover:bg-foreground/5`.

`live-board-ink.test.ts` holds both. A scan of both apps and `packages/ui` on 2026-11-17 found no
other colour utility naming a token `theme.css` lacks.

---

## D29 — FIXED: done, cancelled, waitlisted and lost were faded under the reading bar

**Rule broken:** Colours — every colour pair clears WCAG AA for text.

**Fixed on 2026-11-17, by the operator's ruling: quiet by colour, not by fade.** Text stays at full
ink. A completed run and a cancelled Workshop take the neutral slate pair (`tintBgClassFor('slate')`
and its border and ink); the Tournament's or the Workshop's colour stays on the stripe. A cancelled
Workshop keeps its strike-through and its word. The Blocks view's legend focus keeps its 30%: it is
a filter the organiser switches on.

Rendered and measured on 2026-11-17 (a static page from web-public's production stylesheet, in
Chromium, each opacity composited over what is behind it):

| Where                                                            | It was      | It is |
| ---------------------------------------------------------------- | ----------- | ----- |
| Blocks view, a completed run: its label / its Tournament line    | 2.85 / 2.02 | 7.25  |
| Workshop grids (both apps), a cancelled card: title / seats      | 2.52 / 1.85 | 7.25  |
| Participants, a waitlisted Tournament pill                       | 2.20        | 6.95  |
| A bout page, the loser's score (red / blue side at 40%)          | 1.92 / 1.81 | 4.76  |
| A referee chip's role label, amber skill (70% of the chip's ink) | 2.93        | 4.85  |

The sites: `schedule/BlockGridView.tsx` and `workshops/WorkshopScheduleBoard.tsx` in web-admin;
`schedule/workshops/_components/WorkshopGridBlock.tsx`,
`schedule/tournaments/_components/TournamentScheduleGrid.tsx` (its sub-lines, 70% and 80%),
`participants/_components/tournament-pill-classes.ts` and `match/[matchId]/match-live-view.tsx` in
web-public; and the role label in `PoolSlotCard.tsx`, `bracket/_tabs/RefereesTab.tsx` and
`live/BoardRowDetail.tsx`. Every sub-line at 70%, 80% or 90% of a card's ink on those cards went to
full ink; its size and weight already set it back.

`quiet-states-ink.test.ts` (one in each app), `WorkshopGridBlock.test.tsx` and
`tournament-pill-classes.test.ts` hold them.

---

## D30 — FIXED: a hue, or a raw grey, written as text on a light page

**Rule broken:** Colours — every colour pair clears WCAG AA for text.

**Fixed on 2026-11-17.** Rendered and measured that day (static pages from each app's production
stylesheet, in Chromium):

| Where                                                                 | It was                      | Ratio       | It is                                               | Ratio       |
| --------------------------------------------------------------------- | --------------------------- | ----------- | --------------------------------------------------- | ----------- |
| A side colour as text on a light page: yellow / green / orange / pink | the hex as configured       | 2.8–4.4     | the same hue, darkened                              | 4.55–4.70   |
| Tournament stats, afterblow given / afterblow received                | `orange-600` / `red-400`    | 3.43 / 2.77 | `orange-700` / `red-700`                            | 5.00 / 6.15 |
| Tournament stats, clean hits received                                 | `red-600`                   | 4.57        | `red-800`                                           | 8.00        |
| Tournament schedule grid, a break bar's label (a workshop's amber)    | the bar's colour            | 2.15        | `text-foreground-secondary`                         | 7.58        |
| `/me` schedule, a programme bar's time (amber, on its own wash)       | the bar's colour            | 1.87        | `text-foreground-secondary`                         | 6.59        |
| Archived-Event banner, its date                                       | `yellow-600` on `yellow-50` | 2.84        | `yellow-800`, as its sentence                       | 6.61        |
| Referees › Qualifications, a skill's colour swatch                    | the pale tint, on white     | 1.09        | the skill's colour, with a `foreground/50` hairline | —           |
| The ⓘ of every help tooltip; the "TBD" of an empty podium place       | `slate-400` on white        | 2.63        | `text-muted` / `slate-500`                          | 4.76        |

- **The side colour is the root one.** `legibleOn(hex, 'light')` (`packages/ui` `side-color.ts`)
  promised a legible side colour and clamped only near-white. Every caller that writes a fighter's
  side as text on a light page went through it unchanged: the organiser's match page (score, round
  wins, "+N" per exchange), the public bout page, the print pack, `/me`'s schedule, a referee's
  profile, and the white header of `TVScoreboard`. It now darkens a mid tone, keeping its hue,
  until it is 4.5:1 on the light page: yellow `#ca8a04` → `#9a6903`, green `#16a34a` → `#12823b`,
  orange `#ea580c` → `#c54a0a`, pink `#db2777` → `#d72675`. Red, blue, purple, brown, grey and black
  already read and are returned unchanged. A caller that uses it as a fill (the stripe of a
  `/me` commitment card) gets the darker hue too.
- **A bar's colour is its edge.** The organiser's board already wrote break and programme bars in
  `text-foreground-secondary`; the public grid and `/me` wrote them in the bar's own colour.
- **The stats are data categories, not statuses**, so they stay on palette shades rather than the
  status tokens (D19).

`side-color.test.ts` measures every side colour; `hue-ink.test.ts` (one in each app) and
`light-page-ink.test.ts` hold the rest.

The dark half, `legibleOn(hex, 'dark')`, clamped only near-black; brown was 2.84:1 on the stage.
It is D36.

---

## D31 — FIXED: grey on grey, a dot with no edge, and three small inks

**Rule broken:** Colours — every colour pair clears WCAG AA for text (4.5:1), and a shape that
carries meaning clears 3:1.

**Fixed on 2026-11-17.** Rendered and measured that day (static pages from web-admin's production
stylesheet, in Chromium):

| Where                                                                                    | It was                          | Ratio     | It is                       | Ratio     |
| ---------------------------------------------------------------------------------------- | ------------------------------- | --------- | --------------------------- | --------- |
| A grey chip: `text-muted` on `bg-border`, `bg-foreground/10` or `bg-muted/10`–`/15` (20) | the muted ink                   | 3.79–3.95 | `text-foreground-secondary` | 6.04–6.29 |
| The "+R" button of the penalty editor                                                    | white on `red-500`              | 3.81      | white on `red-700`          | 6.42      |
| The LIVE badge of the dark sidebar                                                       | `text-danger` on a 30% red wash | 3.95      | on a 15% wash               | 5.26      |
| The same badge on the selected row of the Event switcher                                 | `text-gold` on a 30% red wash   | 3.71      | on a 15% wash               | about 4.7 |

- **The grey chips**, 20 sites: "Paused" on live bout cards, a Workshop's duration and language
  tags, "pending" and "lost" on `/me`, a club's member count, notifications "Off", a "draw" result,
  the step circles of the Event wizard and of the import, the "no venue" band of the detailed
  schedule, the weapon and clock-report chips, the "disabled" freshness chip and the club picker's
  count. `bg-background` with the muted ink is 4.56:1 and was left alone. `grey-chip-ink.test.ts`
  scans each app and `packages/ui` for the shape, so a new one goes red; a class string with
  `cursor-not-allowed` is a disabled stand-in and is let through.
- **`TournamentColorDot`** had no edge: a white, silver, yellow or gold dot on a white card was 1.1
  to 1.7:1 and showed no shape. It takes `ring-1 ring-inset ring-foreground/50`.
- **The "+R" red** is a penalty card's colour, not a status, so it stays a palette red (D19) and
  goes one step darker.

The two LIVE badges also wrote "LIVE" as a literal English string, outside i18n; since 2026-11-17
they read `organizer.shell.eventSwitcher.liveBadge` ("EN DIRECT" in French).

**Still open, beside it:** the `inactive` half of the penalty editor's `CARD_CLASSES` is never
read.

---

## D32 — FIXED: the keyboard focus ring could barely be seen on a light page

**Rule broken:** a focus indicator clears 3:1 against what is next to it (WCAG 2.2, 1.4.11).

**Fixed on 2026-11-17, by the operator's ruling: the ring stays gold, the deep one.** Every `Button`,
every dialog button (`dialog-classes.ts`, `DIALOG_BUTTON`) and the download button of an Event's
photos ringed in `gold`: amber-500 on a light page, 2.06:1 against the page — a keyboard user could
barely see which control had focus. They ring in `gold-text`, measured from `theme.css`:

| Surface    | `gold` (was) | `gold-text` (is) |
| ---------- | ------------ | ---------------- |
| light page | 2.06         | 6.79             |
| light card | 2.15         | 7.09             |
| dark page  | 10.69        | 10.69            |
| dark card  | 8.76         | 8.76             |

The dark scope does not move: `gold-text` is the same bright gold there. The 2026-07-27 note in D5
("a deeper amber-500 on light where it needs the contrast") was the step this finishes.
`theme-ink-contrast.test.ts` measures the ring on the four surfaces; `focus-ring.test.ts` and
`photo-download-ring.test.ts` hold the three sites.

**Still open, beside it:** the form fields ring in `accent` at 20–40% (`focus:ring-accent/30` and
its kin, about 120 sites). Those were not measured in this audit.

---

## D33 — FIXED: text under 10px, and the most-read 10px text

**Rule broken:** Type — the app's type is the Tailwind scale; `text-xs` (12px) is its smallest
step. The arbitrary sizes under it had no floor.

**Fixed on 2026-11-17.** There is now a floor of 10px, and the text people read most moved to 11px:

- **8px to 9.6px → 11px:** the "YOU" chip that marks your own row, in ten copies (standings,
  pools, pool matches, Swiss rounds, final ranking, a league's detail on `/me`, and twice in a
  bracket card); the "Now" marker of the two public schedule grids; the utilisation figure of a
  piste on the Blocks view; the conflict badge of the Workshops board.
- **10px → 11px:** the time column of the three schedule grids (header and hour labels), the LIVE
  and NEXT tags of a `/me` commitment card, the role chips of the `/me` dashboard. **10.5px →
  11px:** the labels of the `/me` tab bar on a phone.
- **9px → 10px:** the piste pill of a bracket card, to match the 10px pills in its row; the
  unread count on the phone tab bar, which must fit its small circle.

Rendered on 2026-11-17 with the production stylesheet and the real Geist face, in Chromium: at
375px wide every tab label stays on one line at 11px; at 320px "Mes événements" already wrapped at
10.5px and the bar grows by 1px. "08:00" and the column header still fit the 64px time column. The
"VOUS" chip grows by 5px, and the name beside it truncates 5px earlier.

`type-floor.test.ts` scans each app and `packages/ui` for a `text-[…px]` or `text-[…rem]` under
10px. The stage scale is `clamp()` and is not scanned.

**Still open, beside it:** about 220 sites stay at 10px or 11px. The "YOU" chip is ten hand-copied
spans (D23's class).

---

## D34 — FIXED: every status chip and alert sat just under the reading bar

**Rule broken:** Colours — every colour pair clears WCAG AA for text.

**Fixed on 2026-11-17, by the operator's ruling: about 10% darker, same hue.** A status chip or an
alert writes the status ink on a 10% or 15% wash of itself — every red error box of the product
(`bg-danger/10 … text-danger`), `PageAlert`, `FreshnessChip`, the "Live now" pill, about 140 lines
across the two apps. Measured from `theme.css`, the light values were under 4.5:1 there:

| Status    | Was                 | On its wash (worst) | Is        | On its wash (worst) | Under white |
| --------- | ------------------- | ------------------- | --------- | ------------------- | ----------- |
| `danger`  | `#dc2626` red-600   | 3.67                | `#be2121` | 4.58                | 6.12        |
| `success` | `#15803d` green-700 | 3.93                | `#137337` | 4.59                | 5.94        |
| `warning` | `#b45309` amber-700 | 3.92                | `#a24b08` | 4.57                | 5.92        |
| `info`    | `#2563eb` blue-600  | 4.02                | `#225bd7` | 4.56                | 5.92        |

The worst case is the 15% wash over the light page. The new values are not palette steps on
purpose: one step darker would have made `danger` the accent red, `warning` the `gold-text` amber
and `info` the personal accent blue. `danger-hover` moved one step with its base, to `#991b1b`.

**The stage.** The projector sets no scope, so its status inks were the light values and would have
got darker: the protest chip of the TV scoreboard from 3.46 to 3.00:1, the Live wall's "behind"
cell from 4.01 to 3.40:1. By the operator's ruling those two elements set `data-theme="dark"` on
themselves and read the dark scope's amber: 6.90:1 on the chip's fill, 9.37:1 as text. The wall's
state dots stay light-scope fills, 3.29:1 at the lowest, over the 3:1 a shape needs.

`theme-ink-contrast.test.ts` measures each status ink on its 10% and 15% wash over both light
surfaces, under white, and the stage's warning; `TvProtestChip.render.test.tsx` and
`wall-ink.test.tsx` hold the two stage elements.

The dark scope did not move in this entry: its `danger` and `info` were under the bar on their own
wash over a dark card, 4.27:1 and 4.42:1. They are D37.

---

## D35 — FIXED: what the browser contrast check found after the audit

**Rule broken:** Colours — every colour pair clears WCAG AA for text.

**Fixed on 2026-11-17.** The browser accessibility suite now fails on an axe `color-contrast`
finding (`tests/a11y/helpers.ts`); it used to keep only `critical` findings, and axe rates contrast
`serious`. Its first run, on the fighter app and the console after D26 to D34, failed 12 specs on
five shapes the audit had missed or rated "likely". Measured by axe in Chromium, against the dev
build:

| Where                                                                           | It was                                    | Ratio                      | It is                         | Ratio     |
| ------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------- | ----------------------------- | --------- |
| The password panel, "Set a password" and the reset link                         | `text-accent`, blue on the dark card      | 2.18                       | `text-foreground`, underlined | 13.35     |
| `/me`, the notifications prompt                                                 | `text-muted` on `bg-accent/5`             | 4.21                       | `text-foreground-secondary`   | 6.71      |
| `/me` inbox, an organiser's warning broadcast: its Event, body and time         | the warning ink at 80% and 90%            | 3.58–4.30                  | full ink                      | 5.13      |
| my-schedule cards and the display hub's "Now live" cards: time, piste, opponent | `text-muted` on a red, blue or amber wash | 3.86–3.94                  | `text-foreground-secondary`   | 6.15–6.28 |
| A "Running" Tournament pill on an Event's home                                  | the whole chip pulsing                    | 2.72–3.04 at the faint end | still words, a pulsing dot    | 4.72      |

- **A, D and E** are the shapes of D27, D29 and D31: the accent as ink on a dark panel, a state
  set back by opacity, the muted ink on a wash.
- **The pulse**, by the operator's ruling: a live status pulses a dot, not its words.
  `statusPillClass` no longer adds `animate-pulse`; `StatusBadge` draws a
  `motion-safe:animate-pulse` dot when the status is live. The two status pickers of the console
  are `<select>`s styled with that class; a select cannot hold a dot, so they no longer pulse.

The scoring app's spec passes `{ contrast: false }`: web-staff was not audited.

---

## D36 — FIXED: a brown side on the projector

**Rule broken:** Colours — a shape that carries meaning, and large text, clear 3:1.

**Fixed on 2026-11-17.** `legibleOn(hex, 'dark')` (`packages/ui` `side-color.ts`) rescued only a
near-black side colour. A brown side (`#92400e`) passed through: on the projector stage its score,
its initials ring and its timeline dots were 2.84:1, and 2.52:1 on the dark page. On dark the
helper now lightens a mid tone, keeping its hue, until it is 3:1 on the dark page; brown becomes
`#9b4f21`, 3.00:1 there and 3.39:1 on the stage. 3:1, not 4.5:1, because on dark the side colour is
large or non-text. Every other side colour already cleared it and is returned unchanged, the red
and blue defaults included. `side-color.test.ts` measures all eleven on the dark page and the stage.

**Still open, beside it:** on a dark _card_ (`#1e293b`), blue is 2.83:1 and purple 2.72:1. The
dark cards that draw side colours are in the scoring app, audited separately.

---

## D37 — FIXED: the dark scope's red and blue chips sat just under the reading bar

**Rule broken:** Colours — every colour pair clears WCAG AA for text.

**Fixed on 2026-11-17, on the operator's ruling for the light inks (D34) mirrored: the least move,
same hue.** In the dark scope a status chip writes its ink on a 10% or 15% wash of itself. Over a
dark card, `danger` (`#f87171`, red-400) was 4.27:1 there and `info` (`#60a5fa`, blue-400) 4.42:1.
They are `#f97e7e` (4.56:1) and `#66a9fa` (4.57:1), mixed toward white until the worst wash cleared
4.5:1. Under their dark foreground as a fill they are 7.05:1 and 7.31:1. `success` and `warning`
already cleared it (4.92:1, 5.22:1) and did not move. `theme-ink-contrast.test.ts` measures all four
on both dark surfaces at 10% and 15%.

---

## Fixed

- ~~D9: `/lices` was dark while `/lices/[liceId]` was light~~ — tapping between the two piste screens flashed white. Fixed 2026-08-03: `/lices` had no `data-theme` at all, so it inherited the pad scope from `<body>`; both piste screens are now chrome and take `chromeScope`. The underlying decision — which regions are chrome — is now explicit in `apps/web-staff/src/theme/theme.ts` rather than implied by which screen was written when.
- ~~`web-staff` loaded no fonts at all~~ — it imported `theme.css` but never defined `--font-fraunces`/`--font-geist`/`--font-jetbrains`, so the scorer's tablet rendered display type in Georgia and body in system sans. Valid CSS, correct colours, silently wrong type. Fixed by wiring `next/font` into `apps/web-staff/app/layout.tsx`; `pnpm quality:design-drift` now asserts this class of bug can't recur.
- ~~`web-marketing` requested a non-existent font~~ — see D4.
