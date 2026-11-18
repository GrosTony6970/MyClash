# MyClash — Golden Paths

Canonical end-to-end flows for **manual** smoke testing. Each path must pass on staging before a
production ship.

**These are not the Playwright suites.** An earlier version of this line claimed they were the basis
for them; no test references a `GP-N` (`grep -rn "GP-[0-9]" tests/` returns nothing), and
`tests/e2e/` is organised by feature across 42 specs rather than by golden path. The eleven paths
below do not cover Swiss, leagues, archive/restore, the print pack, the live control room or AI
settings, all of which have specs. Treat this as the manual checklist it is; `tests/e2e/README.md`
is the automated inventory.

**No path and no spec yet** for FightBook, Event photos and the TV screens. The protest counter has
one offline step in `tests/e2e/06-offline-sync.spec.ts` and no path. Check these by hand before a
ship that touches them; they are named here so the gap is visible.

Test matrix per path: **desktop Chrome · mobile Safari · mobile Chrome**

---

## GP-1 — Organiser: Create and run a tournament

**Actor:** Organiser (authenticated, owns at least one organisation)
**Entry point:** `admin.myclash.fr` → login (the organiser workspace; `playwright.e2e.config.ts` defaults its baseURL here)

1. Sign in with a password, or with the link sent by email
2. The organisation exists already: sign-up made it. Create another only if the test needs one
3. Create a new event with the four-step wizard — basics (name, dates, city, time zone, Event kind), venue, branding, review
4. Configure a tournament within the event (format: pools + direct elimination)
5. Add fighters (manual entry + bulk CSV import)
6. Assign fighters to pools (auto-populate)
7. Publish the event → public URL generated
8. **Expected result:** Public spectator page is live at `/e/[eventSlug]` with fighter list and pool draw visible
9. After pools complete: navigate to Bracket management → choose format (single or double elimination) → Generate bracket → confirm bracket slots appear with seeds pre-filled
10. Complete a first-round match → **auto-advance**: winner slot in round 2 fills automatically, new match created for that slot without organiser action
11. Override a slot manually via the pencil icon → confirm override persists and downstream match updates
12. After matches complete: timing stats per match (fight time, total time, judging overhead = total − active) are available via the phase match list in the organiser dashboard

---

## GP-2 — Scorekeeper: Score a fight and see live results

**Actor:** Scorekeeper (assigned to a Lice/piste)
**Entry point:** `staff.myclash.fr` → enter event code

1. Open scorekeeper app on tablet (simulate offline: disable wifi after load)
2. Select assigned Lice
3. Open the current match
4. Record 5 exchanges (mix of clean hits, afterblows, doubles)
5. Press "End match"
6. **Expected result (online):** Match result appears on spectator app within 2 seconds
7. **Expected result (offline):** Score saved locally; reconnect wifi → result syncs automatically

---

## GP-3 — Competitor: Browse results on event day

**Actor:** Competitor (no login required for public view)
**Entry point:** `app.myclash.fr/e/[eventSlug]`

1. Open public event page on mobile (375 px viewport)
2. View pool standings
3. Navigate to personal schedule (my fights)
4. View a completed match detail (exchanges breakdown)
5. Check bracket / elimination draw
6. **Expected result:** All views load under 3 s on a 3G throttled connection; no horizontal scroll

---

## GP-4 — Super-admin: Approve an organiser

**Actor:** Super-admin
**Entry point:** `admin.myclash.fr/admin` (the admin console is a distinct host — `web-admin`, not `app.myclash.fr`)

1. Sign in with a password, or with the link sent by email
2. Navigate to `admin.myclash.fr/admin/organizations`
3. Find a pending organisation awaiting approval
4. Inspect the org detail page
5. Approve the organisation
6. **Expected result:** Organisation status changes to `active`; organiser receives confirmation email (or in-app notification if email not configured)

---

## GP-5 — Super-admin: Toggle a feature flag

**Actor:** Super-admin
**Entry point:** `admin.myclash.fr/admin/feature-flags`

1. Sign in
2. Toggle a non-critical feature flag off → on
3. Verify the flag change persists on page reload
4. Toggle back
5. **Expected result:** Flag state round-trips correctly; no other UI state affected

---

## GP-6 — Organiser: Export results

**Actor:** Organiser
**Entry point:** Event dashboard

1. Navigate to a completed event
2. Export results (CSV or PDF — whichever is implemented)
3. **Expected result:** File downloads without error; contains correct fighter names, scores, and rankings

---

## GP-7 — Auth: Session lifecycle

**Actor:** Any authenticated user

1. Sign in with a password, or with the link sent by email
2. Close browser tab
3. Re-open the app — session should be restored (no re-login required within token TTL)
4. Sign out explicitly
5. Attempt to access a protected route
6. **Expected result:** Redirect to login; no stale session data visible

---

## GP-8 — Scorekeeper: Offline resilience

**Actor:** Scorekeeper
**Entry point:** `staff.myclash.fr`

1. Load the scorekeeper app while online
2. Disable network entirely
3. Score a complete match (multiple exchanges, then "End match")
4. Verify the sync bar shows "OFFLINE - exchanges queued locally"
5. Re-enable network
6. **Expected result:** Pending exchanges sync within 10 seconds; match result visible on spectator app

---

## GP-9 — Scorekeeper: a whole bout, and the next one, with no network

**Actor:** Scorekeeper, signed in with the Event code, a username and a PIN
**Entry point:** `staff.myclash.fr`
**Automated twin:** `tests/e2e/40-offline-bout.spec.ts`, `tests/e2e/41-next-bout-no-network.spec.ts`

1. Sign in and open the first bout of the piste while online
2. Disable network entirely
3. Start the bout, pause it, score exchanges, end it
4. Reload the page in the middle of a bout
5. Tap "NEXT" (the next-bout tile in the pad header, or the button on the result screen) to open the next bout of the piste
6. Re-enable network
7. **Expected result:** the reload opens the bout from the tablet's own copy; the next bout opens with no network; after reconnect the server holds both bouts, in order

---

## GP-10 — Front desk: check a person in, check their gear

**Actor:** Volunteer with a check-in or gear-check staff login
**Entry point:** `staff.myclash.fr`
**Automated twin:** `tests/e2e/33-staff-desk.spec.ts`

1. Sign in with the Event code, the username and the PIN of a check-in login
2. Find a person by name and tick them in
3. Scan another person's Event pass (the QR code on their phone) and tick them in
4. Sign in with a gear-check login and record a person's gear as checked
5. **Expected result:** each tick shows on the desk and survives a reload; a scoring login reaches neither the desk nor the gear table

---

## GP-11 — Attendee: book a Workshop session

**Actor:** A signed-in person on the Event's roster
**Entry point:** `app.myclash.fr/e/[eventSlug]/workshops`
**Automated twin:** `tests/e2e/19-workshops.spec.ts`

1. Open the Workshop catalogue and filter it
2. Open a Workshop and book one of its sessions
3. Book a session that is full
4. As the first person, cancel the booking of the full session
5. **Expected result:** the first booking shows in My Schedule; the full session puts the person on the waiting list; the cancellation promotes them to a seat

---

## Failure classification

| Result             | Meaning                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| **Pass**           | Flow completes without error or unexpected behaviour                           |
| **Pass with note** | Minor deviation logged (e.g. slow load on 3G, cosmetic glitch) — not a blocker |
| **Blocker**        | Flow cannot be completed; production ship paused                               |

All GP-1 through GP-4 are **required passes** before ship. GP-5 through GP-11 are required passes or pass-with-note.
