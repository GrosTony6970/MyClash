# MyClash — Golden Paths

Canonical end-to-end flows used for manual smoke testing (Phase 10) and as the basis for Playwright E2E suites. Each path must pass on staging before a production ship.

Test matrix per path: **desktop Chrome · mobile Safari · mobile Chrome**

---

## GP-1 — Organiser: Create and run a tournament

**Actor:** Organiser (authenticated, owns at least one organisation)
**Entry point:** `app.myclash.fr` → login

1. Sign in via magic-link email
2. Create a new organisation (if none exists)
3. Create a new event — name, date, location, discipline
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
5. Submit final score
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

1. Sign in via magic-link
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

1. Sign in via magic-link
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
3. Score a complete match (multiple exchanges, submit)
4. Verify app shows "offline — pending sync" indicator
5. Re-enable network
6. **Expected result:** Pending exchanges sync within 10 seconds; match result visible on spectator app

---

## Failure classification

| Result             | Meaning                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| **Pass**           | Flow completes without error or unexpected behaviour                           |
| **Pass with note** | Minor deviation logged (e.g. slow load on 3G, cosmetic glitch) — not a blocker |
| **Blocker**        | Flow cannot be completed; production ship paused                               |

All GP-1 through GP-4 are **required passes** before ship. GP-5 through GP-8 are required passes or pass-with-note.
