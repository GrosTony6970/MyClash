# The log entry side panel — design

Request B of the ops requests track (2026-11-20). The operator: "in the audit log menu, when
clicking on an entry I want to see in a side panel the corresponding log, if it was
successful/failed the error and so on, a bit like Azure event viewer".

## In plain words

The console's Log page has two tabs. The Audit tab lists who changed what. The Platform tab lists
AI scans, failed broadcasts, deletions, merges and database query errors. Today a row shows a
squeezed summary, and the only way to read more is a small "Details" pop-up for the payload.

After this slice, a click on any row of either tab opens a panel that slides in from the right
over the dimmed list. The panel shows that one entry in full:

- **Audit tab:** when (full date and time), who (name and email), the action, the target (its name,
  then its id in small grey text, for copying), the **Result** (green Succeeded, red Failed with the
  exit code and "timed out" when it timed out, grey Started for a backup that was only started),
  then every recorded field on its own line, nested values included.
- **Platform tab:** when, the category, the severity, the event (a link when it has one), the whole
  detail text in a code block (not cut), who, and for a database query error how many times it
  happened, when it first happened, and the Resolve button.

Previous and Next buttons, and the up and down arrow keys, move through the list without closing
the panel. Escape, the Close button or a click on the dimmed list closes it. The Audit list gets a
Result column with the same green / red / grey mark, and a dash for every row that records no
outcome.

The panel shows only what the entry already stores. A failed restart says "Failed · exit code 1",
because the row keeps no error text today (ruling 913).

## Rulings (operator, 2026-11-20)

- **911** Story: "this morning the ops agent restarted web-public; you click that row". **The panel
  shows the row's own record, laid out well**, not an operation's separate log. **Both tabs** get
  the panel. **Previous / Next** and a **Result column**; no link to one entry.
- **912** **The panel slides over, the list dimmed**, about 36rem wide, built once in the shared UI
  kit. Not docked beside the list.
- **913** **No stored output for now.** A failed system action keeps only `ok`, the exit code and
  `timedOut`; storing its last output lines is its own slice (the ops runner must return them, and
  they must be checked for secrets first).
- **914** **A row with no recorded outcome shows a dash.** Only system actions get a mark. The rule
  lives on the server, in one place.

## Design

### The shared panel: `Modal` gets a side placement

`Modal` (`packages/ui/src/components/Modal.tsx`) is the one owner of the dialog's accessibility:
portal, focus trap (`useFocusTrap`), Escape through the layer stack (`useDialogLayer`), backdrop
click. A second component would copy all four. So `Modal` gains `placement?: 'center' | 'side'`
(default `center`, so no caller changes):

- `side`: the backdrop aligns to the right with no padding (no `items-center`, no `p-4`); the card
  is full height (no `max-h-[90vh]`), `max-w-xl` (36rem), square corners, a left hairline only, and
  **no shadow** (the paper rule: DESIGN.md "Elevation & Depth"; the centred card's `shadow-xl` is
  deviation D15 and is not copied). It slides in with a new `sheet-enter` keyframe (`translateX`,
  180 ms) in `apps/web-admin/src/styles/globals.css`, inside the existing reduced-motion guard.
  `size` and `placement: 'side'` are exclusive in the props type.
- The header, the scrolling body and the sticky footer are the same as the centred card.
- Two optional props, unused by the existing callers: `onKeyDown` on the dialog element (the
  panel's arrow keys), and `returnFocus` (below).

### Focus (found by the cold review)

- On close, `useFocusTrap` gives focus back to what had it when the dialog opened. After a mouse
  click (nothing focused) or after Next (another row), that is wrong. `useFocusTrap` and `Modal`
  take an optional `returnFocus: () => HTMLElement | null`; the panel passes the time button of the
  row it shows now. The other three trap users pass nothing and keep today's behaviour.
- Previous / Next at a page edge are `aria-disabled`, not `disabled`: a disabled button that holds
  focus drops it to `<body>`, out of the trap. Pressing an `aria-disabled` one does nothing.
- The arrow keys listen on the dialog, not on `document`. They are ignored inside the scrolling
  body (where they scroll a long payload), in a form field or `contenteditable`, and with a
  modifier key.

### The outcome: one rule on the server

`apps/api/src/modules/admin/audit-outcome.ts` (new): `auditOutcome(action, payload)` returns
`'succeeded' | 'failed' | 'started' | null`. It answers only for `system.*` actions:

| Payload                                       | Outcome     |
| --------------------------------------------- | ----------- |
| `ok: false`, or `timedOut: true`              | `failed`    |
| `status: 'failed'`                            | `failed`    |
| `scheduled: true` (`system.tls.renew`)        | `started`   |
| `status: 'running'` (`system.backup.run`)     | `started`   |
| `ok: true`                                    | `succeeded` |
| anything else, or an action outside `system.` | `null`      |

`AdminAuditLogService.list` adds `outcome` to each row (`AuditLogRow.outcome`). The CSV export does
not change (not asked). The list has no typed response DTO, so no OpenAPI change.

### The console

- `useEntrySelection(items)` (new hook, `apps/web-admin/app/admin/audit-log/use-entry-selection.ts`):
  the selection is `{ id, index }`, and the row shown is worked out **during render**, never in an
  effect: the row with that id, else the row now at that index, else (an empty list) none, and the
  panel closes. The race it names: while the panel is open, only Resolve reloads the list (paging
  and filters sit under the scrim). The list drops a resolved query error
  (`admin-platform-log.service.ts:247`), so after Resolve the panel shows the row that took its
  place. `step(±1)` stays within the page: Previous on the first row and Next on the last do
  nothing (`aria-disabled`); the panel does not turn the page.
- A row opens the panel on click. Its time cell is a real `<button>`, so the keyboard opens it too.
  The row opens the panel only when the click happened inside the row's own DOM
  (`currentTarget.contains(target)`: React carries a click inside the portalled Details pop-up up
  to the row) and not on a link or a button (the Platform event link, the payload Details button,
  Resolve).
- A failed Resolve shows its message inside the panel (the page's banner is under the scrim).
  Resolve is disabled while it runs and while the list reloads, so it cannot be sent twice.
- The selected row carries `aria-current="true"`; the dash of a row with no outcome has a spoken
  name ("No result recorded").
- An exit code shows only when it is a number: a timeout or a runner error records none.
- **Complexity.** `AuditLogPanel` (baselined at `:73`, about 255 lines) and `PlatformLogPanel`
  (`:99`, about 300 lines) must not grow: the rows move into `AuditLogTable.tsx` and
  `PlatformLogTable.tsx`, the filters into `PlatformLogFilters.tsx`. Only those two baseline keys
  are re-pointed, never the whole file. **As built:** they shrank to 213 and 192 lines; `Modal`
  (baselined at `:52`) grew by 5 lines for its two new options and is re-pointed to `:75`. Every
  new function stays under 50 lines: the row click and the time button are one shared `EntryRow`,
  the Result chip one `ResultMark` used by the list and the panel.
- `AuditEntryPanel.tsx` and `PlatformEntryPanel.tsx` (new): the side `Modal`, its title the action
  (Audit) or the event (Platform), the footer "Previous · n of m · Next · Close".
- The payload tree: `PayloadCell.tsx`'s private `PayloadNode` is exported and used
  by the panel, so labels replace ids exactly as in the existing Details pop-up. One owner.
- `PlatformLogPanel.tsx` is at 397 lines (the cap is 400): its filter form moves into
  `PlatformLogFilters.tsx` before the panel goes in.
- The Result column in the Audit list: `StatusBadge` with `semantic` `done` (Succeeded), `danger`
  (Failed), `pending` (Started); a dash otherwise. `StatusBadge` itself still paints from palette
  classes (`status-pill.ts:68-76`, known palette debt); it is still the one status chip to use.
- Every new string in `en` and `fr` under `admin.auditLog.panel.*`, `admin.auditLog.result.*`,
  `admin.auditLog.columns.result` and `admin.platformLog.panel.*`.

### What the panel does not show

The raw ids are not the headline: the target's name comes first, its id second in small grey text
(the audit log is forensic: the id is the join key; DESIGN.md "Content" allows the raw id as the
chain's last link). Payload key names stay verbatim, as in `PayloadCell` today.

## Tests (each seen red first)

1. `audit-outcome.test.ts`: each row of the table, and a non-`system.` action with `ok: false` is
   `null`.
2. `admin-audit-log.service.test.ts`: a listed row carries `outcome`; the select string is unchanged.
3. Audit tab (jsdom, `apiRequest` mocked, `offsetParent` stubbed so the focus trap runs): the
   Result column shows Failed for the failed restart and a dash for `event.update`; a row click
   opens the side dialog with the action, the target's name, "Failed · exit code 1"; Next moves to
   the next row; ArrowUp on the footer moves back, ArrowDown inside the body does not; Next on the
   last row does nothing and keeps focus; Escape closes and focus lands on the shown row's time
   button; a click on the row's Details button, and on the Details pop-up's backdrop, does not open
   the panel.
4. Platform tab (jsdom): a row click opens the panel with the whole detail text; a click on the
   event link does not open it; Resolve in the panel sends the PATCH, and after the reload (the row
   gone) the panel shows the row that took its place; a refused Resolve shows its message in the
   panel.
5. `useEntrySelection`: the row is found by id after a reorder; a vanished id falls back to the
   same index; an empty list closes.
6. `Modal` side placement: the dialog carries the side classes and no `shadow-xl`; the centred one
   is unchanged. `returnFocus` wins over the element focused at opening.
   6b. `auditOutcome`: a scheduled renewal is Started, not Succeeded (found by the cold review).
7. The i18n sweep: every new key in `en` and `fr`.

## Found by the whole-slice review (fix pass)

- A focused element can leave with its row: the Event link, or Resolve, when Previous / Next or a
  reload shows an entry without one. Focus then fell to the page behind, out of the trap, and the
  arrow keys stopped. The panel now gives focus back to its footer's position line.
- Resolve was natively `disabled` while it ran, which drops its focus the same way. It is
  `aria-disabled` now, and its click is held while it runs or while the list reloads; a test
  proves a second click sends nothing.
- The panel showed the page-wide error banner's text. It shows only a refused Resolve, and only
  on the entry it belongs to.
- Not fixed (LOW): when Resolve empties the page, the panel closes and no row is left to take
  focus, so it goes to the page.

## Not in this slice

A link to one entry, storing a failed action's output (913), the CSV's outcome column, the Platform
tab's own Result column (its Severity column already says it).
