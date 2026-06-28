# Scoreboard UI/UX refinement — recommendations + clickable mockup

> **Clickable mockup:** [`scoreboard-mockup.html`](./scoreboard-mockup.html) — open in any browser
> (no build, no backend). Use the demo bar (top) to switch **Afterblow (Deductive / Full)**,
> **Device (Desktop / Tablet)**, or **Jump to finish**. Everything on the board is clickable.

## Context

The live match-scoring screen (`apps/web-scoring`) works but isn't yet user-friendly. It's a dark
3-column layout (**red | center | blue**) with a large **white Forfeit panel pinned at the bottom**,
per-fighter clean-hit / afterblow / penalty-**search** / direct-card controls, and a center timer +
exchange history. It must serve **both tablet (touch) and laptop (pointer)** and a **mix of operators**
(first-time volunteers + trained staff).

The through-line is **progressive disclosure**: the primary scoring surface stays clean and always
visible; rare/dangerous actions move behind one entry point; labels are clear for newcomers but quiet
enough not to slow veterans. Everything reuses existing primitives in `packages/ui` and the semantic
tokens in `packages/ui/src/theme.css`. New strings must be added EN+FR in `packages/i18n` (CI-gated).

## The north star

Split the screen into two planes:

- **Live scoring (95% of taps):** score, clean hit, afterblow, double / no-exchange, timer, undo.
  Always visible, big, calm.
- **Match administration (rare / destructive):** forfeit, direct card, reset, colour/side swap,
  corrections. Behind **one** "Match actions" entry — reuse the existing `Drawer`
  ([MatchCorrectionsDrawer.tsx](../../apps/web-scoring/src/components/MatchCorrectionsDrawer.tsx)).

## Priority table

| #     | Issue                                                         | Fix (tokenized)                                                                                      | Primitive / token                                 | Impact | Effort |
| ----- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------ | ------ |
| P0-1  | Forfeit panel is the loudest element yet the rarest action    | Move it into the "Match actions" Drawer; replace with a quiet header button                          | `Drawer`, `Button`, `ConfirmDialog`               | High   | Med    |
| P0-2  | Colour collision: red = fighter / danger / red-card / forfeit | Reserve red+blue for fighters only; destructive actions neutral, `danger` red only at confirm        | `--color-strong`, `--color-danger`, `sideStyle()` | High   | Low    |
| P0-3  | Destructive actions rely on prominence, not guardrails        | Gate forfeit / end / red+black card / reset behind `ConfirmDialog`; routine undo via toast-with-undo | `ConfirmDialog`/`useConfirm`, `Toast`/`useToast`  | High   | Low    |
| P1-4  | Penalty **search** box is slow for live use                   | Quick-pick chips for common penalties; full searchable list behind "More"                            | `Pill`/`Button`, keep existing search             | High   | Med    |
| P1-5  | `+2/+1`, `2-1/1-1` are cryptic                                | Persistent inline micro-labels (+ tap "?" popover — no hover-only on touch)                          | text + tokens; `HelpTooltip`/popover              | High   | Low    |
| P1-5b | "Double" reads ambiguously                                    | Crossed-blades **⚔** on the DOUBLE button and every Double timeline row                              | icon + tokens                                     | Med    | Low    |
| P1-6  | "Clear last exchange" is buried                               | Promote Undo to a first-class control + toast "Recorded +2 Red — Undo"                               | `Button`, `useToast`                              | High   | Low    |
| P1-7  | Exchange history is tiny / dense                              | Larger type, clearer columns (time · dot · fighter · type · delta)                                   | type-scale tokens                                 | Med    | Low    |
| P2-8  | Locked state just dims everything to 40%                      | Collapse controls → clean read-only summary + timeline                                               | `StatusBadge` (semantic)                          | Med    | Med    |
| P2-9  | Weak "who's leading" / no cap progress                        | Leader glow + a cap-progress bar toward `pointCap`                                                   | `ScoreDisplay` (`showLeader`)                     | Med    | Low    |
| P2-9b | Match winner not obvious once decided                         | Gold **🏆** beside the winner — live the moment a fighter clinches, and in the locked summary        | trophy icon + `--color-gold`                      | Med    | Low    |
| P2-10 | Round/phase indicator too small                               | Promote round + phase next to the timer                                                              | `Pill`, type tokens                               | Low    | Low    |
| P2-11 | Touch targets uneven across controls                          | Every interactive el ≥44–48px; most-used in thumb reach                                              | layout only                                       | Med    | Low    |
| P2-12 | Header is crowded                                             | Group secondary items; keep fighters + code primary                                                  | `Button`, layout                                  | Low    | Low    |
| P2-13 | No match context (tournament / pool / piste)                  | Header context line **above** fighter names: Tournament · Pool · Piste                               | `Pill` + type tokens                              | Med    | Low    |

## Notes from building the mockup

- **Fighter colour fidelity:** the real `ScoringColumn.tsx` / `MatchHeader.tsx` render the _border_
  hex for big score numerals and names (`#dc2626` / `#2563eb`), not the panel hex — the mockup matches
  the live code (the `side-color.ts` doc-comment that says "panel" is stale; worth fixing the comment).
- **Direct cards** are rendered as **chips** (swatch + label), not solid colour bars — the red card is a
  chip, and the danger-red fill appears only inside the confirm dialog (P0-2).
- **End match** and **red/black direct cards** route through the confirm dialog; **yellow** card and
  routine undo do not (guardrails sized to risk, P0-3).
- The mockup is **verified in a real browser** across: active idle, live scoring with leader glow,
  live clinch (gold score + 🏆 + full cap bar), the actions drawer, the confirm dialog, the decided /
  read-only winner view, and the tablet stacked layout. Accessibility pass: focus trap + `inert` +
  `role=dialog` on drawer/confirm, `aria-live` toast, `:focus-visible`, ≥44px targets, AA contrast.

## What NOT to do

- **No Tabs for the main scoring surface** — none exists in `packages/ui`, and tabs would hide primary
  scoring behind a click. Keep the symmetric columns + one admin drawer.
- **No new raw colours or ad-hoc classes** — extend the primitive (`Button` variants, `Pill`) rather
  than copying classes.
- **No hover-only affordances** (breaks on tablet).

## Validating once built

- **Two-operator hallway test:** a first-time volunteer + a trained staffer each score a mock match on
  **a tablet and a laptop**. Watch for: mis-taps on fighter vs danger colours (P0-2), hesitation on
  `+2/+1` meaning (P1-5), time-to-record a penalty (P1-4), recovery after a wrong tap (P0-3/P1-6).
- **Locked-match check:** a locked match reads as "done," not "broken/greyed" (P2-8).
- **Tokens/i18n gate:** `pnpm build` (or `packages/i18n/src/t-key-references.test.ts`) must pass — every
  new string resolves EN+FR.
