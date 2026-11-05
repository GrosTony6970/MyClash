# Event photos — ruling 443: the organiser approves on an archived Event — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the operator asked for a native build) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On an archived Event the organiser's Photos page offers Approve on a waiting photo, and the server accepts it, as Delete already does. The `photos` staff login still stops at archive (ruling 438). The mode and New link stay refused.

**Architecture:**

- API: `POST events/:eventId/photos/:photoId/approve` (`photos.controller.ts:150`) gains `@AllowOnArchivedEvent()`, as the delete beside it has (`:165-166`). Neither `PhotoModerationService.approve` nor its gate `eventForOrganiser` reads the Event's status, so nothing else refuses it. The staff routes (`photos-staff.controller.ts`) are untouched: their gate (`StaffService.assertEventOpenFor`) refuses an archived Event.
- web-admin: `PhotoQueue` no longer disables Approve on an archived Event. Its `readOnly` prop then has no reader and goes. The mode panel and the link panel keep `isReadOnly`.

**Tech Stack:** NestJS decorator metadata, vitest (API and web-admin jsdom), the archived-page harness (`archived-page.fixtures.tsx`, presses every live button and lists the writes).

**Spec:** `docs/superpowers/specs/2026-11-03-event-photos-design.md`: Goal 7 (`[rev 441]` line), "Moderation", "Constraints from the codebase" (the archived-Event lock ledger bullet).

## In plain words

The Event is a shop again. At 00:30 on the second night the caretaker locks it for good (ruling 441). A phone sent a photo at 23:55, just before the photo box closed. In "Approve first" mode that photo waits for the organiser. Today the lock stops the organiser's Approve, so the photo stays hidden until it is deleted on day 31. The organiser can already throw a photo away after the lock (Delete, for privacy), but cannot put one on show.

The fix: the organiser's Approve works on an archived Event, as Delete does. On the Photos page the Approve button stays live. The photo volunteer's login still stops at the lock (ruling 438). The mode switch and "New link" stay locked, so no new photo can arrive.

One consequence for later: once the public photo list exists (slice 4), an approved photo shows on the public page of an archived Event until its deletion date. That is the ruling's intent, and it needs no extra work in slice 4: the public read hides only draft and test Events (`isPublicEvent`, `event-read-gate.ts:23-39`), not archived ones.

## Operator rulings for this slice

- **443** (2026-11-05 ~13:40) Story: in Approve-first mode a phone sends a photo at 23:55 on Monday, the job archives at 00:30, and Approve is refused on an archived Event, so the photo stays hidden until day 31. Ruling: **the organiser may approve on an archived Event, as Delete already allows; its own small slice after 441.**
- **438** stands: the `photos` staff login stops at archive, Delete included.
- **444** (2026-11-05 ~15:50) Story: a `photos` staff session ends at 06:00 after the last day, then runs 12 h sessions (`staff.service.ts:1662-1673`), while the upload window closes at midnight the day after; a volunteer moderating that day may have to sign in again. Ruling: **leave it**: signing in again is enough, and the organiser approves from the admin site.

## Assumptions (mine; the operator reads them in the report)

1. **Organiser only.** The admin page's Approve opens; the staff screen's does not (438).
2. **No time limit of its own.** Approve stays open on an archived Event until the deletion instant. From then the queue is empty (`PhotoModerationService.list`, `expired`), so no button is shown. The route itself does not check the instant, for an approve as for a delete today; the expiry job removes the rows. Unchanged, named.
3. **No new string.** The button and its refusal messages already exist in EN and FR.

Line references below are as of `767f30c6`, before the build.

## As built: the plan reviews, folded

- myclash-plan-review: converged in 1 pass (1 MINOR folded: fetch, HEAD and status before staging; 1 NIT accepted).
- Cold plan-reviewer: no BLOCKER, no MAJOR; 3 MINOR folded: falsifier rows 1 and 4 anchored on two lines (the single-line anchors match twice and abort); slice 4 needs no extra work for archived Events (`isPublicEvent`).

## As built: the cold code review (code-architecture-reviewer, opus), folded

- No Critical, no Important. Folded, comments only: the reason now reads "a photo still waiting when the Event was archived", which also covers a manual archive (442), not only the window's last minutes; the decorator's own list of uses names the Event photo delete and approve; "moderator's" became "organiser's" in the ledger bullet and the routes test (the staff login stops at archive, 438).
- Noted, unchanged: no HTTP-level test sends a real approve through the guard (the decorator test plus the guard's own tests hold it, as for the delete); the organiser shell's archived banner was already shown above a live Delete.
- As built: 4 seeded breaks, all red with the counts constant (API 25, web-admin page 18).

## Global Constraints

- Hard rule 9: one commit, one concern (`feat(photos): …`, header ≤ 100 characters, lower-case subject).
- No DB change, no new string, no new route. No OpenAPI change (the decorator is not in the spec).
- The opt-out list in `archived-lock.routes.test.ts:81-110` is pinned exactly and sorted by key (`write-routes-scan.ts:82`).
- `placed` (188) counts routes by path, opted out or not (`archived-lock.routes.test.ts:32`): it stays 188.
- `quality:shared-types` flags the English word for "every one" (a-n-y) in a comment: avoid it.
- `pnpm format:check` covers this plan file: run Prettier on it before the gates.

## Review Focus

1. **The staff approve stays refused on an archived Event** (438). → pinned today by `photos-staff.controller.test.ts:113-123` and the staff session check; Task 1 leaves both untouched and the falsifier re-runs the staff test.
2. **The mode and New link stay refused on an archived Event.** → the exact opt-out list (Task 1) and the archived page test (Task 2), which sends only approves and deletes.
3. **A page that hides the button while the server opens the route** (prompt §7, 222d). → Task 2 presses every live button on the archived page and expects the approves.
4. **Two organisers: one deletes, the other approves the same photo.** → unchanged: `photo_not_found` and its own message (`usePhotoModeration.ts`, `send`).
5. **The photo goes public on an archived Event** once slice 4 exists. → said in "In plain words"; slice 4's concern.

---

### Task 1: the API opens Approve on an archived Event

**Files:**

- Modify: `apps/api/src/modules/photos/photos.controller.ts:150` (decorator + docstring citing 443)
- Test: `apps/api/src/modules/photos/photos.controller.test.ts:151-160`
- Test: `apps/api/src/common/event-readonly/archived-lock.routes.test.ts:81-110` (and the comment at `:141`)

**Interfaces:** none new. `AllowOnArchivedEvent` from `common/event-readonly/allow-on-archived.decorator`.

- [ ] **Step 1: Change the tests**
  - Controller test: rename to `'the approve and the delete stay open on an archived Event (ruling 443)'`; `expect(open('approve')).toBe(true)`; add `expect(open('rotateLink')).toBe(false)`, so the test still pins a write that stays closed.
  - Routes test: insert `'POST events/:eventId/photos/:photoId/approve'` after `'POST events/:eventId/feedback'`, with the comment `// Event photos (ruling 443): a photo still waiting at archive can still be shown.` `placed` stays 188; the `:141` comment adds "the approve opted out by 443, still placed".
- [ ] **Step 2: Run, expect red**
      `pnpm --filter @myclash/api exec vitest run src/modules/photos/photos.controller.test.ts src/common/event-readonly/archived-lock.routes.test.ts` → 2 failures (approve not open; list mismatch).
- [ ] **Step 3: Add `@AllowOnArchivedEvent()` under `@Post(...approve)`**, docstring: `/** Open on an archived Event (ruling 443): a photo still waiting at archive can still be shown. */`
- [ ] **Step 4: Run, expect green** (same command), plus `src/modules/photos/photos-staff.controller.test.ts` green unchanged.

### Task 2: the admin Photos page offers Approve on an archived Event

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/photos/PhotoQueue.tsx` (drop `readOnly` from `QueueProps` and from the Approve `disabled`; docstring: Approve and Delete stay open on an archived Event)
- Modify: `.../photos/page.tsx` (stop passing `readOnly` to `PhotoQueue`)
- Modify: `.../photos/usePhotoModeration.ts` (the comment above `useEventStatus`: the server refuses the mode and New link; approve and delete stay open)
- Test: `.../photos/page.archived.test.tsx`

- [ ] **Step 1: Change the test**: title `'sends approves and deletes, and nothing else'`; the taken map adds `'POST /api/v1/events/ev1/photos/p1/approve': { id: 'p1', status: 'approved' }` and the same for `p2`; the expectation stays `new Set(sent)` equal to the map's keys. Docstring: approve (443) and delete stay open; the mode and New link do not.
- [ ] **Step 2: Run, expect red**: `pnpm --filter @myclash/web-admin exec vitest run "app/org/[slug]/events/[eventId]/photos/page.archived.test.tsx"` → the approves are missing.
- [ ] **Step 3: Implement** the three file changes above.
- [ ] **Step 4: Run green**: the archived test and `page.test.tsx` beside it.

### Task 3: docs, falsify, review, gates, commit

- [ ] **Docs**: the design's Goal 7 `[rev 441]` line ("Approve after archive is the next slice (443)") → "**[rev 443]** The organiser may approve on an archived Event, as Delete allows; the `photos` staff login stops at archive (438)." The ledger bullet (`:196-197`) names the organiser's approve and delete, and their reasons. `docs/ARCHITECTURE.md:2636` list of `@AllowOnArchivedEvent()` uses gains "an Event photo's delete (privacy) and approve (443)".
- [ ] **Falsify** (copy `falsify-archive-hold.mjs`; anchors after Prettier), each must go RED with collected counts constant:
  1. remove `@AllowOnArchivedEvent()` above `@Post('events/:eventId/photos/:photoId/approve')` → controller test + routes test red;
  2. add `@AllowOnArchivedEvent()` above `@Post('events/:eventId/photos/link/rotate')` → routes test + controller test red;
  3. `page.tsx`: `onApprove={photos.approve}` → `onApprove={photos.isReadOnly ? async () => undefined : photos.approve}` → archived page test red;
  4. `PhotoQueue.tsx`: `disabled={queue.busy}` on Approve → `disabled={queue.busy || photo.status === 'waiting'}` → archived test red (a disabled Approve).
- [ ] **Cold review**: `code-architecture-reviewer` (opus) on the diff.
- [ ] **Gates**: `gates.sh` (33 lines, all `0`). No migration, so no replay. API changed: boot the image once (`boot-image.sh`).
- [ ] **Commit**: `git fetch`, `git log --oneline -1`, `git status --short` first; then `feat(photos): an organiser approves a waiting photo on an archived event, as delete already allows` (check ≤ 100 chars), explicit staging list (`git add --pathspec-from-file`), read `git diff --cached --stat`, `git commit -F`.
- [ ] **Complexity**: no baseline entry sits in a touched file (`docs/code-quality-complexity-baseline.json` has none for `photos.controller.ts`, `PhotoQueue.tsx`, `page.tsx`, `usePhotoModeration.ts`); nothing to re-point.
