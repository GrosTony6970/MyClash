# Protest counter (réclamations) — design

> Status: design, from a brainstorm with the operator on 2026-11-16, approved with every "My call"
> on 2026-11-17. Built slice by slice, planned with `superpowers:writing-plans`.

## Context

During a Match a fighter sometimes stops and disputes the referee's call (a protest, "réclamation").
Today nothing in MyClash records that. The referee has to remember how many times each fighter
protested, and the built-in FFAMHE penalty list already punishes abuse of it (entry 8,
"Contestation abusive": yellow, red, red, black — `packages/db/migrations/0054_penalty_card_costs_and_seed.sql:94`).

The operator wants the scorekeeper to count protests per fighter on the scoring pad, beside the
card counters. The count serves four purposes, all confirmed by the operator:

1. It is the referee's memory aid.
2. It has a limit per fighter per Match.
3. It is kept after the Match.
4. The audience sees it.

## Goals

- One tap on the pad records one protest for one fighter.
- A protest works offline, exactly as a card does, and "Undo last entry" takes it back.
- Each protest is a row in the Match's history, with its clock time.
- An organiser sets a limit per Tournament. Past the limit, the pad asks whether to give a
  penalty the organiser chose. The scorekeeper answers yes or no.
- The TV scoreboard shows each fighter's protest count beside the card counters.
- The fighter's own statistics, the referee's statistics and the Event's statistics count protests.

## Non-goals

- No outcome per protest (accepted or refused). Every protest counts the same.
- No reason text, no protests by a coach, no protest by anyone but the two fighters.
- No automatic card. No refusal of a protest because the limit is reached.
- No limit on the penalty list. No limit carried from one Match to the next.
- No protest column in the organiser's CSV exports. No protest on a public fighter profile.

## Anti-goals (a failure even if it works)

- A protest that is counted as a card anywhere: the card ladder, forfeits, the score, card totals.
- A protest that changes a score. The score comes from Exchanges and cards only (hard rule 1).
- A tap that is lost offline, or counted twice after a retry.
- A question on the pad that slows scoring: the card offer must close in one tap.

## Approaches

| #   | Approach                                                                                                                               | Trade-off                                                                                                          | Verdict                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| 1   | **A protest is its own kind of entry.** Own table beside Exchanges and cards, shares their numbering, own offline kind, own API doors. | Most files. No reader of cards can ever count a protest by mistake.                                                | **Picked by the operator.**         |
| 2   | A card with no colour, stored in `match_penalties`.                                                                                    | Offline, undo and history nearly free. Every reader of cards must learn to skip it; a missed one fails in silence. | Rejected.                           |
| 3   | Two numbers on the Match.                                                                                                              | Cheapest. No history row, no time, and a retry can count twice.                                                    | Dropped: does not give the history. |

Where the limit lives was a second fork:

| Option                                                 | Trade-off                                                                                                                                             | Verdict                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **Tournament settings**, beside "Quick-pick penalties" | Each Tournament chooses; can change during the day.                                                                                                   | **Picked by the operator.** |
| On the penalty list                                    | A list in use is locked and the built-in list is super-admin only (`penalties.service.ts:489-525`); must join the list's version history (~16 files). | Rejected.                   |

## Decided by the operator

| Question                                               | Ruling                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| What is the count for?                                 | All four: referee's aid, a limit, a record, shown to the audience.                                            |
| Fighter goes past the limit                            | The pad **offers** the card (yes / no). It never blocks and never gives a card by itself.                     |
| Referee agrees with the protest                        | It still counts. One tap per protest, no outcome.                                                             |
| Where is it found afterwards?                          | The Match's history, the fighter's own statistics, the referee's and the Event's statistics. Not the exports. |
| How is a protest stored?                               | Its own kind of entry (approach 1).                                                                           |
| Where is the limit set?                                | In the Tournament's settings. Empty = no limit.                                                               |
| Protest against the hit that ends a round or the Match | It can be recorded. The button stays live until the results are locked.                                       |
| Who sees a referee's protest count?                    | The referee (signed in, own profile) and organisers. Never the public.                                        |

## Behaviour

### On the scoring pad (`apps/web-staff`)

```
            RED · Jean D.
   [▪ 1]  [▪ 0]  [▪ 0]     [✋ 2/2]
   yellow  red   black     protests   ← a button; the card chips stay display-only
```

- The protest chip sits in the card-chip row of each fighter's column
  (`apps/web-staff/src/components/ScoringColumn.tsx:322-345`).
- A tap records one protest at once, with no question (as a yellow card is given at the tap).
- **The button is live longer than card entry.** Card entry is off once the Match is no longer
  running or paused, or while a round waits for its start (`MatchView.tsx:514-517`). The protest
  button stays live in those moments too: paused, between rounds, and after the end. It goes off
  only when the results are frozen or the Match is locked. The server follows the same rule: it
  takes a protest between rounds and on a completed Match, and refuses it only when frozen or
  locked.
- A protest recorded between rounds, or after the end, is stamped with the round that just ended.
- The chip shows `count` when the Tournament has no limit, `count/limit` when it has one.
- The chip turns to the warning colour when `count >= limit`.
- The count is the server's live protests plus the ones waiting on the tablet, each counted once
  (the rule the card chips use: `apps/web-staff/src/offline/pending-events.ts:228-237`).
- "Undo last entry" takes back a protest when it is the newest entry of the Match.

### The card offer

- It appears when a tap makes `count > limit`. With limit 2, the third protest offers. With
  limit 0, every protest offers. It appears again on every later protest.
- The protest is recorded **before** the question. "No" changes nothing.
- The question names the fighter, the penalty and the card that will really be given, for example
  "Give _Contestation abusive_ (red card) to Jean D.?". The card comes from the same resolver the
  penalty list uses (`resolveCard`, repeat offences climb the ladder).
- "Yes" gives that penalty through the normal card path (`submitPenalty` → `queueCard`,
  `ScoringColumn.tsx:187-215`). The offer **is** the confirmation: no second "are you sure" for a
  red or black card.
- It works offline: the penalty list is cached on the tablet and the count is local.
- **The offer appears only at a moment when the pad accepts a card** (the existing rule, unchanged).
  Between rounds and after the end, a protest past the limit counts and warns, and offers nothing:
  the server would refuse a card between rounds (`penalties.service.ts:941`), and an offer that
  ends in the held inbox is worse than none. The referee can still give the card by hand when
  card entry is live again.
- No offer when the Tournament has no limit, when no penalty is chosen, or when the chosen
  penalty is not in the Match's penalty list. The chip still counts and still turns to the warning
  colour. The Tournament's settings page says so (see below), so the missing offer is not silent.

### In the Match's history

- A protest is a row of the shared history list: clock time, fighter, the word "Protest", an
  icon, no points. The list orders rows by the time they happened, with the shared numbering as
  tie-break (`exchange-timeline.ts:144-151`); a protest takes its place the same way.
- **A protest row carries no `#N`.** Hits and cards keep the numbers they have today, so hit #5
  is hit #5 with or without a protest before it. The pad's "N exchanges" label
  (`ScoringCenterControls.tsx:560`) and the bout-flow chart (`packages/ui/src/utils/bout-flow.ts:320-323`)
  do not count protests, and the chart draws no mark for one.
- The history is one builder (`buildUnifiedTimeline`, `packages/ui/src/utils/exchange-timeline.ts:174-267`)
  drawn by `MatchTimeline`. It already feeds the pad, the pad's end-of-Match screen, the TV
  scoreboard, the public match page and the organiser's live room. All of them get the row.
- The public match page shows protests as history rows only. It has no card counters today and
  gets no protest counter.

### On the TV scoreboard

- `TVScoreboard` (`packages/ui/src/components/TVScoreboard.tsx:436-497`) draws the same chip
  beside each fighter's card chips: `count` or `count/limit`, warning colour at the limit.
- It updates live, as the card chips do (`packages/ui/src/hooks/useLiveMatch.ts:197-220`).

### In the Tournament's settings (`apps/web-admin`)

- Settings → Display tab, beside "Quick-pick penalties"
  (`.../tournaments/[tournamentId]/settings/_components/DisplayTab.tsx:449-467`).
- Two fields: **Protest limit** (a whole number ≥ 0, empty = no limit) and **Penalty offered past
  the limit** (one entry of the Tournament's penalty list, or none).
- A limit with no penalty chosen shows a note: the pad will count and warn, and offer nothing.

### In the statistics

- **Fighter's own statistics** (private dashboard, where "penalties received" is): protests made,
  following the same Event and weapon filters.
- **Referee's statistics:** protests faced. A protest counts for a referee on the Matches where
  that person was the declarant referee — the rule cards given use
  (`apps/api/src/modules/fighters/referee-stats.ts:174-183`).
  - It is **private**. "Cards given" sits in the public part of the referee payload
    (`referee-stats.ts:211-218`, served by slug to the public page). Protests faced must go in the
    private part: the referee sees it on their own profile when signed in, the public never does.
- **Event statistics:** one "protests" column in the Event's per-referee table, beside cards given
  (`apps/api/src/modules/event-stats/event-stats.service.ts:305-343`), under that table's own rule
  (completed Matches only). If that table is served to anyone but organisers, the column stays out
  of what they receive.
- Voided protests are never counted.

## Data and doors

- **New table `match_protests`**, shaped after `match_penalties`
  (`packages/db/migrations/0016_penalties.sql:39-64` plus 0018, 0095, 0191), without the card
  columns: `id`, `client_uuid` (unique), `match_id`, `tournament_id`, `registration_id`,
  `sequence` (unique per Match), `round_number`, `clock_time_ms`, `occurred_at`, `recorded_at`,
  `by_user_id`, `staff_account_id`, `voided`, `voided_reason`.
- `sequence` comes from the one counter Exchanges and cards already share
  (`apps/web-staff/src/offline/db.ts:142-148`). It breaks ties in the history and tells the undo
  which entry is newest.
- **Read rule:** the same readers as `match_penalties` at HEAD (hard rule 4). **Writes:** the API
  only, as 0238 did for the other Match tables. Live updates enabled, as 0167 did for cards.
- **API**, in the penalties module's style: record a protest (a resend with the same
  `client_uuid` returns the saved row), void a protest, list a Match's protests (public, as the
  card list is). Recording uses the same permission as recording a card
  (`staff.authorizeMatchScoring`).
- A protest never calls the score recompute.
- **Settings:** `config.display.protests = { limit: number | null, offerPenaltyRef: number | null }`
  in the Tournament's scoring config, beside `quickPenalties`
  (`packages/types/src/scoring-config.ts:82-93`). The penalty is named by its `ref_number`, as
  quick-picks are, so it survives a new version of the penalty list. It is read live from the
  Tournament, not copied into the Match's rules: the server decides nothing from it.
- **Offline:** a new outbox kind `'protest'` (`apps/web-staff/src/offline/db.ts:48`). A protest is
  an entry of the Match's sheet, not a tap: `isTap` answers false. A refused protest goes to the
  held inbox, as a refused card does.
- **The compiler finds most places the new kind must reach, not all.** The kind union is switched
  on with no `default`, so those switches fail to compile until they handle it. Four places
  escape the compiler and must be done by hand, each with a test:
  - `apps/web-staff/src/offline/pending-events.ts:181-211` — an `if` with a fall-through; a
    waiting protest would be drawn as a clean hit.
  - `apps/web-staff/src/offline/sync.ts:381-395` — the retry's read of used sequence numbers
    lists two tables by hand.
  - `apps/web-staff/src/lib/server-entries.ts:47-53` — the undo's read of the server's entries
    does the same. Missing it breaks "undo removes it on the server". `ServerRow`
    (`server-entries.ts:7`) and `ServerEntry` (`lib/void-entry.ts:18`) are two separate unions.
  - `apps/web-staff/src/offline/kept-bout.ts:27` — the Match copy kept for offline holds two
    lists only.
- **A Match that is reset loses its protests.** The reset voids hits and cards
  (`apps/api/src/modules/phases/revert-match.ts:51-63`) and must void protests too, and a protest
  recorded before the last reset is refused as other entries are
  (`apps/api/src/modules/matches/bout-not-started.ts:53`).

## Races

- **The same protest sent twice** (lost answer, retry): one row, by `client_uuid`.
- **The count while a protest waits on the tablet:** server rows plus waiting rows, joined on
  `client_uuid`, so a protest the server already holds is counted once.
- **Undo after a card was given from the offer:** the card is the newest entry, so the first undo
  takes the card and the second takes the protest. No special case.

## My calls (not asked — correct any of them)

1. **The limit is per Match, not per round.** In a best-of Match the count runs across rounds.
   The operator said "during a fight".
2. **A protest row has no number in the history.** Numbering it would renumber every later hit
   on every screen.
3. **A reset Match starts at zero protests.** Otherwise a replayed Match opens at `2/2` and
   offers a card on the first protest. This removes those protests from the record.
4. **Undoing a protest once the Event is over follows the card rule** (super admin only,
   `penalties.service.ts:1146-1148`), not the hit rule (a review request).
5. **Between rounds and after the end, a protest is stamped with the round that just ended.**
6. **No card offer at a moment when the pad accepts no card.** The counter still counts and warns.
7. **No audit-log entry.** Cards have none; the row itself says who recorded it.
8. **The offer repeats on every protest past the limit**, not only the first.
9. **The TV shows the limit too** (`3/2`), not the bare count.
10. **Words:** EN "Protest / Protests", FR "Réclamation / Réclamations". All strings through i18n
    in both languages (hard rule 6).
11. **The chip uses design tokens**, a neutral one and the warning one. The card chips' raw-colour
    exemption does not extend to it.
12. **Fighter statistics stay private**, as "penalties received" is.

## Left to the builder

- The exact read-rule text: take it from `match_penalties` as the database holds it after the
  latest migrations, not from the text of 0200.
- Every registry a new table must join: the archive registry
  (`apps/api/src/modules/exports/archive.tables.ts`), the RLS probe tables
  (`scripts/lib/rls-probe-tables.mjs`), the realtime bindings check
  (`scripts/check-realtime-bindings.mjs`), the cascade probe, `docs/DATABASE_REVIEW.md`.
- How the TV receives the Tournament's limit: the way it already receives the side colours.
- The icon, the chip's exact tokens and its touch size, within `DESIGN.md` and
  `docs/design/web-staff.md` (read `docs/design/known-deviations.md` first).
- Whether the protest count for the offer needs a helper beside `countFor`, or extends it.
- The shape of the statistics payloads.
- A new section in `docs/ARCHITECTURE.md` for protests, written with the first slice.

## Slices (one commit each)

1. **Server:** the table, its read rule, live updates, the API doors, the registries, the
   architecture section.
2. **Pad:** the outbox kind, the chip, undo, the history row, the held inbox.
3. **Limit and offer:** the two Tournament settings, the warning colour, the offer on the pad.
4. **TV scoreboard:** the chip and its live updates.
5. **Statistics:** fighter, referee, Event.

## Verification

- Each slice proves its acceptance criteria with tests (hard rule 10), written first.
  - Server: a resend returns the same row; a protest never moves a score; a voided protest
    leaves every count; the read rule lets the public read a published Match and nobody write.
  - Pad: a protest tapped offline is in the queue before any network call, survives a reload,
    drains once; undo removes it on the tablet and on the server; the history shows it in order.
  - Offer: limit 2 → no offer at 2, offer at 3 and at 4; "no" gives nothing; "yes" queues the
    chosen penalty with the resolved card; no limit / no penalty / unknown ref → no offer; a
    protest past the limit between rounds or after the end is recorded and offers nothing.
  - Moments: a protest is accepted between rounds and on a completed Match, by the pad and by
    the server; it is refused once results are frozen or the Match is locked.
  - Reset: a reset Match shows zero protests, and a protest sent from before the reset is refused.
  - Privacy: the public referee payload carries no protest count; the signed-in referee's does.
  - TV: the chip follows a new protest and a voided one without a reload.
  - Statistics: a protest counts for the fighter and for the declarant referee; a voided one
    does not; a card total is unchanged by any number of protests.
- The offline E2E tests pass (hard rule 3). The FAL 2026 golden test stays green untouched
  (hard rule 2).
- `pnpm db:migrations:replay` for the migration; the full gate chain through the
  `myclash-gates` skill before each push.
- By hand on the test Event: tap protests on a tablet in airplane mode, reconnect, watch the TV
  chip and the public history follow.
