# ADR-021 — One banner, rooms on the grid, spring-loaded day tabs, twelve planner fields, two referee routes

**Date:** 2026-09-14
**Status:** Accepted

## Context

Five shape questions on the two boards, each with a fact behind it.

- **Banners.** The schedule board runs four warn-only detectors, each with its own banner: fighter
  clash, piste stack, bar collision, referee check. The referee banner is already split into a
  "board, now" group computed from the cards on screen and a "server, as of …" group re-read with a
  delay, and its code forbids merging the two into one list, because the fresh half would vouch for
  the stale one (`apps/web-admin/app/org/[slug]/events/[eventId]/schedule/RefereeConflictBanner.tsx:12-27`).
  The map of who referees what, which feeds the live group, is read once at page load and never
  again (`useScheduleData.ts:232-242`).
- **Workshops.** The grid shows a Workshop only as a bar across every piste. Sessions live on a
  second board whose columns are venue rooms, sharing only the time axis with the grid
  (`packages/schedule-core/src/workshop-board-geometry.ts:1-8`). The product document promises one
  day grid.
- **Days.** No drop target exists for another day: the day tabs take clicks only
  (`grid.tsx:1566-1595`), and every drop handler writes to the active day. Moving a bout to Sunday
  is drag to the tray, click Sunday, drag onto a piste. When a generated day runs past midnight,
  Generate pins the bar at 23:59, places the fights on the next calendar day and warns
  (`programme.service.ts:1090-1100`); a bar drag in the same case is refused whole. A bout rolled
  past the Event's last day has no tab to live on in admin.
- **The planner.** Fifteen fields produce thirteen effects: the piste count is already known from
  the Event's Lices (`programme.service.ts:396`), registration and gear check are summed before use
  (`:592`), and only the length of the midday break is read, not its end (`:571`). Day start and end
  cannot be derived; nothing stores venue hours.
- **The referees page.** One file of 2,692 lines holds four tabs; the Assignments tab is about a
  thousand lines with twenty pieces of state and re-reads the Event's days on its own
  (`referees/page.tsx:621-1670`). The pools page already splits its tabs into files.

## Decision

- **One banner, sections kept apart.** The four detectors render in one banner component, one
  section each, every section stamped with where it comes from and how fresh it is. Sections are
  never merged into one list, so the freshness rule survives. The referee section's map of who
  referees what is re-read together with its server section, not once at page load.
- **Workshop sessions on the grid, read-only.** Each venue's band gains a column per room beside its
  pistes, and sessions render there as blocks. Moving a session stays on the workshop board. A
  drop contract for rooms on the grid may follow if the read-only lane proves its worth.
- **Spring-loaded day tabs.** While dragging a card, hovering a day tab for a moment switches the
  board to that day; the drop lands where the organiser releases. No new drop target.
- **Generate refuses a day that would cross midnight**, whole, the way a bar drag already does. The
  warning text becomes the refusal: shorten the day or move a block. Nothing lands where no tab can
  show it.
- **Twelve planner fields in three groups.** The piste count goes (the Event's Lices decide);
  arrival and gear check become one duration; the midday break is a start and a length. Day: start,
  end, midday start, midday length. Bouts: the four lengths, with the per-Tournament rows of
  ADR-018, the gap, the rest. Blocks: break between sessions, referee meeting. This is the sheet's
  field list.
- **Two routes for the referee workspace.** `/referees` keeps List, Qualifications and Staffing as
  light tabs, split into files as the pools page does. `/referees/assignments` is the board on its
  own route, with its own load and a deep link.

## Consequences

- **Easy:** one place to look for what is wrong on the board, and each line says how old it is.
- **Easy:** one screen shows a day's fights and workshops side by side.
- **Easy:** the planner asks only for what it cannot know.
- **Hard:** the twelve-field sheet changes the Suggest body; every caller that sends the old
  fifteen, including the end-to-end specs, changes with it.
- **Hard:** the two referee routes split state that today sits in one file; the board must load
  its own skills and days rather than borrow the roster's.
- **Committed to:** no merged conflict list; no editable room lane yet; no bout the admin board
  cannot show.

## Alternatives considered

- **Keep four banners.** Rejected: four places to look for one question.
- **One merged conflict list.** Rejected: breaks the freshness rule on purpose.
- **One grid with rooms and pistes both editable.** Deferred: the largest build on the map; the
  read-only lane is the first step and may be enough.
- **Two boards and a corrected document.** Rejected: the operator wants the day on one screen.
- **Drop a card on a day tab to send it to that day's tray.** Rejected: still two gestures.
- **Keep the midnight warning.** Rejected: bar and fights disagree until someone notices, and a bout
  past the last day is invisible in admin.
- **Keep fifteen planner fields.** Rejected: two of them carry no information the Event does not
  already have, and two pairs carry one number each.
- **Four referee routes, one per tab.** Rejected: three of the tabs are light people administration
  and share their data.
- **One referee page with tabs in files.** Rejected: the board has its own audience and load, and
  deserves a link of its own.
