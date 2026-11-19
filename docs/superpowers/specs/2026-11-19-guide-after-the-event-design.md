# Organiser guide, part 5: print, photos, notifications, debrief — design

Status: approved by the operator on 2026-11-19, with rulings 891-894
(`docs/notes/quick-wins-2026-10-08.md`): bugs 1-4 and the copy fixes first, one commit each; Bug 5
is fixed the other way round, by completing a Tournament automatically (its own slice); the event
menu hides an entry below its role (its own slice); the four pages go in a new fifth section. The
pages then describe the fixed app.

Builds on the shipped organiser guide (parts 1-4 in `docs/superpowers/archive/specs/`): same site
(`apps/web-marketing`, `/guide` FR and `/en/guide` EN), same Markdown collection, same tests, same
screenshot script.

## Intent

Part 1 left out the print pack, photos, notifications and the debrief. Part 4 covered the rest of
that list. A test organiser who wants paper sheets in case the wifi dies, photos from the public,
to tell everyone the pools are ready, or to see afterwards what went wrong finds nothing in the
guide today.

## Goals

Four pages, FR and EN:

1. **The print pack** (`print-pack`). Where it is (a card on the event's overview), the four sheet
   kinds (pool, bracket, piste day-sheet, match scoresheet), A4, one print job. Print before the
   event: the page needs the network. What it leaves out (Swiss bouts). Who can print (every
   member).
2. **Photos** (`photos`). The three modes (Off, Approve first, Live) and that a photo's state is
   fixed when it arrives; the QR link and poster, and **New link**; who can send (anyone with the
   QR, or a signed-in person from their personal space); when sending is open (the day before to
   the day after); JPEG only, 12 MiB, no progressive JPEG; moderation by an admin or a Photos
   tablet; Report and Keep; a person who asks for a photo to go; every photo deleted on the 31st
   day after the event; the zip. Nothing is notified: check the tabs.
3. **Notifications** (`notifications`). What MyClash sends by itself (bout and duty reminders,
   workshop changes, waitlist seat, results, Swiss pairing, new event to followers) and what
   silences each; the **Notifications** page and its audiences; **Notify participants**; the
   workshop message; the passes by email. People without an account get nothing automatic. The
   worker must run. What reaches the organiser (safety reports only).
4. **The debrief** (`debrief`). The six cards and when one needs a look; the feedback panel and its
   public form (share the link yourself: nothing sends it); the clock report.

Screenshots, English only, from the same script and test Event, where a test Event can show them.

## Facts the code holds (checked; organisers would guess these wrong)

- Nothing completes a **Tournament** by itself. The results notice goes out only when the organiser
  sets it to Completed, and auto-archive waits for every Tournament to be completed (see Bug 5).
- Bout reminders and referee lock messages **do** ring at a Test event; a waitlist seat and a
  broadcast ring even at a Draft one.
- A bout reminder never falls back to email; moving a bout sends no "schedule change" notice.
- The debrief can be opened at any time, not only after the event.
- A photo sent while the mode is Approve first stays waiting after a switch to Live.
- The print pack prints no Swiss bout.

## Bugs found while checking (each its own fix, outside this slice)

1. **Bracket bouts print with no referee.** `bracketToPrint` sets `referees: []`
   (`print/build-print-data.ts:125`) although the bracket API sends them. Bracket scoresheets and
   piste rows say "Not assigned".
2. **Double-elimination rounds print as "Round of 1", "Round of 0.5".** The API sends `rounds: 0`
   for that format (`phases.service.ts:2074`, `config.rounds ?? 0`), and the print page's round
   namer counts back from it.
3. **The debrief's detail lines are English on a French screen** (hard rule 6): "unlabelled
   device", "refused", "still held", "unspecified" are built by the API
   (`event-stats/post-event-report.ts:87-90,116,134`), with raw reason codes.
4. **A broadcast says "delivered" when nothing was sent.** With no phone and no email address the
   email fallback returns at once, and the recipient is still marked delivered
   (`notification-scheduler.worker.ts:865-868, 882-883, 922`).
5. **The Tournament status help says it "moves to completed when the final has been fought"**
   (`statusHelp.tournament.running.next`). No code does that.

Smaller copy fixes the check found: `feedback.headline` says "1 responses"; the print sheet's
"Generated" time uses the printing machine's time zone; the Photos description names only the QR
code; "Schedule changes" describes less than it gates; the server says "12 MB" for 12 MiB. From
part 4: the built-in FFAMHE plan's description is French seed text on the English screen.

Not a bug yet, a call for the operator: the **Photos**, **Notifications** and **Debrief** menu
entries show to every member, and the page refuses a member below its role (admin, admin,
scorekeeper). Part 4 kept the house rule for a switch (ruling 888).

## Constraints

Unchanged from parts 1-4: FR and EN for every page (hard rule 6); no real person in any screenshot
(hard rule 7); labels copied from `packages/i18n`; facts checked against the code; the screenshot
Event is `test` kind and is deleted; ask the operator before each run on the deployed stack; the
`myclash-gates` chain before pushing. The guide describes the code as it is when the page ships.

## Left to the builder

Titles, the screenshot list and where each image sits, and the commit split.
