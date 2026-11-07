# Event photos — a super admin moderates any Event's photos (rulings 491-494) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the operator builds native) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A platform super admin opens `/admin/photos`, sees the Events whose photos are on (or still kept), opens one, and sees, approves, deletes or Keeps its photos with the same tabs and buttons the club sees. Each of those actions is recorded in the audit log. The privacy policy names MyClash's platform administrators among the moderators.

**Architecture:**

- **API, one owner of moderation.** The five moderation routes the club page already calls (`GET …/photos/summary`, `GET …/photos`, `POST …/:photoId/approve`, `DELETE …/:photoId`, `POST …/:photoId/keep`, `photos.controller.ts:174-285`) take a new gate, `PhotoModerationService.eventForModerator(eventId, userId)`: the club admin as today, or else a `super_admin`. The QR link, its rotation and the zip download keep `eventForOrganiser` (club admins only, ruling 492). No new moderation route, no second service.
- **The gate's order.** `assertOrgRole(admin)` first, so a club admin's request reads nothing new. Only when it refuses with "not a member / role too low" (a `ForbiddenException`) is the platform tier read, with `readPlatformRole` (it THROWS on a failed read: a hiccup is a 5xx, never a silent refusal and never a pass, ruling 461). Not `super_admin` → the original refusal is rethrown.
- **The audit row.** When the gate passed on the platform tier, approve, delete and Keep write one `insertAuditLog` row BEFORE the change (`action` `event_photo.approve` / `event_photo.delete` / `event_photo.keep`, `entityType` `event`, `entityId` the Event, payload `{ photoId }`). A failed audit write refuses the change (5xx): nothing a super admin does to a club's photos goes unrecorded. A club admin's actions write no row, as today.
- **The list.** A new controller `PlatformPhotosController` at `admin/photos`, **in `PhotosModule`** (not `AdminModule`: that module does not import `PhotosModule`, `admin.module.ts:76-84`, and a module cycle shows only at real boot), with `@UseGuards(PlatformRoleGuard)` (a host-module guard works because `SupabaseService` is global, `common/auth/platform-role.ts:17-25`) and class `@PlatformRole('super_admin')` (the one decorator that narrows a GET, `guards/platform-role.guard.ts`). One route `GET admin/photos/events`: the Events whose `photo_mode` is not `off`, plus those that still hold photos (`event_photo_events()`, 0250), newest `start_date` first, at most 200, each read with the same columns as `photoEvent` (`photo-organiser.ts:39`); the clubs' names by a SECOND plain read `organizations … .in('id', ids)` (no embed, so no live PostgREST proof is owed); for each Event the summary's `waiting` and `reported` (`PhotoModerationService.summary`, the one owner of those counts). Both select strings are asserted in the tests.
- **The controller's helper split.** The private `organisersEvent(eventId, req)` (`photos.controller.ts:287`) serves the download (`:218`) as well as the moderation routes: it becomes two, `organisersEvent` (link, rotate, download) and `moderatorsEvent` (summary `:174`, queue `:185`, approve `:232`, delete `:248`, keep `:267`).
- **web-admin.** `usePhotoModeration` (`org/[slug]/events/[eventId]/photos/usePhotoModeration.ts`) is split: `usePhotoQueue(eventId)` (summary, list, approve, Keep, delete, load more) moves to `src/components/photos/` with `PhotoQueue`; the org hook composes it with the link and the mode. `useEventStatus` (`usePhotoModeration.ts:64`, it reads the ORGANISER shell's context, absent under `/admin`) stays in the org hook: it only closes the mode and the new link on an archived Event, and approve, delete and Keep stay open on one (443). Two new pages: `app/admin/photos/page.tsx` (the list) and `app/admin/photos/[eventId]/page.tsx` (`PhotoUsage` + `PhotoQueue` through `usePhotoQueue`; no link, mode or download panel). A nav item "Photos" in `SuperAdminShell.tsx` (`minRole: 'super_admin'`, icon `photos`).
- **Policy.** §3bis "Who sees them", FR + EN.

**Spec:** the design `docs/superpowers/specs/2026-11-03-event-photos-design.md`; rulings 483 (a parent's removal "we remove it"), 485 (joint control), 491-494 below.

## In plain words

Tom's mother writes to LYON AMHE. You sign in to the admin site and click **Photos** in the menu. You see every Event that takes photos: the Lyon Open, its club, its dates, "3 waiting, 1 reported". You open it and see the same three tabs the club sees: Waiting, All, Reported. You find Tom's photo and press Delete; it asks first, as for the club. The photo goes at once, the image within minutes. The audit log now shows "event_photo.delete, Lyon Open, by you, 18:42".

You cannot rotate the Lyon Open's QR code, turn its photos off, or download its zip: those stay the club's. The club's own admins see no change.

The privacy policy's photo section now says the moderators are the club's admins, its photos volunteers, and MyClash's platform administrators, who step in to answer requests and stop abuse.

## Rulings (2026-11-07)

- **491.** A platform super admin may moderate any Event's photos (leftover 4 of slice 8).
- **492.** Moderation only: see, approve, delete, Keep. Not the QR link, not the on/off mode, not the zip.
- **493.** The way in is a new admin page `/admin/photos` listing the Events whose photos are not Off; a click opens the same list the club sees, reusing its parts.
- **494.** Each super-admin approve, delete or Keep writes an audit row; the club's own moderators write none (as today). The policy's moderators gain MyClash's platform administrators, FR + EN.
- Earlier today: 488 (no new-tab cue), 489 (the delete box names the photos, `3bda2e14`), 490 (the API logs keep the IP).

The next free ruling number is **495**.

## Assumptions (mine; the operator reads them before the build)

1. **`super_admin` exactly**, for the list and the moderation. A `platform_admin` or `platform_viewer` sees no Photos item and gets 403.
2. **The audit row is written before the change and a failed write refuses it** (as `frozen-results.guard.ts:335-351`), rather than best effort after it (as `admin-organizations.service.ts:700-715`). `entityType` `event` reuses the Event label already in the audit page.
3. **The list holds at most 200 Events** and reads three small queries per Event (the summary's counts). A platform with more than 200 photo Events needs paging; named, not built.
4. **A super admin who is ALSO a club admin** (the dual-role account, `reference_super_admin_not_org_member`) passes as a club admin on that club: no audit row there.
5. **The policy date.** If no deploy happens between today's push and this one, the date stays **2026-11-07** and the one banner covers it. If a deploy happens first, this push gets its own date. I will ask before the push.
6. **No new page under `/org/...`** and no change to the club page's look: its tests stay green unchanged except imports.
7. The super admin's queue page shows the Event's name from the summary (`PhotoSummary.eventName`, `packages/types/src/event-photos.ts:208`) and needs no list read; its timezone comes from the summary too (`:221`).
8. **The audit row is written before the change, so a refused change (photo gone, photo of another Event: 404) still leaves its row.** The row records the request, not the outcome; accepted rather than a row written after the change that a failure could lose.
9. **UNVERIFIED: the API-wide route test still passes** with the gate catching `assertOrgRole`'s refusal: the scan follows calls to a refuser (`common/testing/route-authz-scan.ts:64-74`), and the gate still calls `assertOrgRole`. Settled by `pnpm --filter @myclash/api exec vitest run route-authz` after Task 1.

## Policy text (FR and EN) — for the operator to read

EN, §3bis "Who sees them", the moderators bullet, replaces "The moderators are the organising club's administrators and the volunteers it gives the photos to.":

> The **moderators** are the organising club's administrators, the volunteers it gives the photos to, and MyClash's platform administrators, who step in to answer requests and stop abuse.

FR, remplace « Les modérateurs sont les administrateurs du club organisateur et les bénévoles à qui il confie les photos. » :

> Les **modérateurs** sont les administrateurs du club organisateur, les bénévoles à qui il confie les photos, et les administrateurs de la plateforme MyClash, qui interviennent pour répondre aux demandes et faire cesser les abus.

## Tasks

### Task 1: The gate and the audit row (API)

- [ ] `eventForModerator` in `photo-moderation.service.ts` (order and loud read above); the controller's five moderation routes call it, link / rotate / download keep `eventForOrganiser`.
- [ ] **Every gate answers `PhotoEventRow & { auditActor: string | null }`, a REQUIRED field** (cold review MAJOR 1): `eventForOrganiser` and `eventForStaff` set `null`, `eventForModerator` sets the super admin's id when it passed on the platform tier. `approve`, `remove` and `keep` (also called by `photos-staff.controller.ts:56,71,82` and `testing/moderation-doubles.ts:136`) take that type, so a write handed an Event without a gate's verdict does not compile. A non-null `auditActor` writes the row first; its failure throws a plain `Error` (a 5xx), not the `BadRequestException` of `frozen-results.guard.ts:351`.
- [ ] The row's payload: `{ photoId, sentAt }` (the photo's send time, so the audit page reads more than a raw id; a deleted photo has nothing else to name it by).
- [ ] Tests: a club admin passes with no platform read and no audit row; a super admin non-member passes and each write leaves one row with the photo id, **its insert ordered before the `event_photos` write** (assert the call order, not only that both happened); a club member below admin who is also a super admin passes the platform way and leaves a row; a caller with no platform row gets the SAME refusal back (403, "not a member"); a `platform_admin` non-member is refused; a failed platform read is a 5xx; a failed audit write leaves the photo untouched; the download, link and rotate still refuse the super admin (`photos.controller.download.test.ts:49` already pins the download's gate).
- [ ] Accepted, named: a super admin known only by the `app_metadata.role` claim (`platform-role.guard.ts:133-137`) sees the list but is refused per Event (`readPlatformRole` reads the table only, `platform-role.ts:77-91`); the bootstrap writes the table row (`bootstrap-super-admin.mjs:168-172`).
- [ ] `route-authz.test.ts` stays at its pins (the gate still reaches `assertOrgRole`); archived-lock stays 192 (no new write route).

### Task 2: The list route (API)

- [ ] `PlatformPhotosController` + `GET admin/photos/events` (type in `packages/types`, rebuilt to `dist` before the API reads it), registered in `PhotosModule`; a row in `platform-role-coverage.test.ts` (`CONTROLLERS` :66-97 and `EXPECTED` :106+, `['GET /admin/photos/events', 'super_admin']`); OpenAPI emitted (`quality:openapi-drift`); the API image boots.
- [ ] **The reads, in order** (cold review MINOR 3): (1) `events` with `photo_mode` not `off`, and (2) `event_photo_events()` (only `event_id, end_date, timezone`, no order, 0250:76-83), each bounded below PostgREST's 1000 rows; (3) `events … .in('id', union)` with `photoEvent`'s columns, `start_date` descending with `nullsFirst: false` and `id` as tie-break, cut to 200 AFTER the merge; (4) `organizations … .in('id', clubIds)`.
- [ ] **The counts** (MINOR 2): a `counts(event)` (waiting, reported) pulled out of `summary` (`photo-moderation.service.ts:98-102,245-276`), which keeps using it; the list calls `counts`, not `summary` (no usage read, no throw on an unknown mode `:104`), at most 8 Events at a time.
- [ ] Tests: Off Events with no photos are left out; an Off Event still holding photos is in; newest first, a null date last; the counts are `counts`'; a read failure is a 5xx; the select strings asserted. **Falsify the coverage row**: drop the `EXPECTED` row with the controller still in `CONTROLLERS` (`platform-role-coverage.test.ts:66-97`) → red.

### Task 3: web-admin

- [ ] Split `usePhotoModeration` → `usePhotoQueue` (shared, `src/components/photos/`) + the org hook; move `PhotoQueue` and `PhotoUsage` beside it. The org page's tests green, imports only.
- [ ] `app/admin/photos/page.tsx` and `[eventId]/page.tsx`, i18n EN + FR (`admin.photos.*`), the nav item; each page opens its own `<main>` (gutters test).
- [ ] `SuperAdminShell.tsx` is 652 lines and baselined (`docs/code-quality-complexity-baseline.json:143`, functions at `:645-646`, lines 182 and 500): the nav item shifts both; re-point those two entries only (targeted merge, `reference_complexity_baseline_targeted_merge`), never regenerate.
- [ ] **Name the race** (MINOR 7): today one `fetchSnapshot` reads summary, link and queue together (`usePhotoModeration.ts:43-51`); after the split the org hook's link read is a second reader and must re-read on the queue's `reload`, or a rotate shows the retired link (`page.test.tsx:249-257` pins it and must stay green unchanged).
- [ ] The nav label `admin.shell.nav.photos` EN + FR. A `platform_admin` or `platform_viewer` reaches `/admin/photos` by URL (the shell admits every tier, `SuperAdminShell.tsx:204-208`; the item is only hidden, `:262`): the page shows the 403 as a message, tested.
- [ ] The queue page's header shows the Event's photo mode (`PhotoSummary.mode`), so an Off Event reads as Off.
- [ ] Tests (jsdom, as the org page's): the list renders and links; the queue page approves, deletes (asks first) and Keeps through the same routes; no link, mode switch or download control on it; the 403 message.

### Task 4: Policy (commit 4)

- [ ] The bullet above, FR + EN; `legal.ts` comment names 494; the date per assumption 5.

### Task 5: Proof, review, push

- [ ] A falsifier (one row per behaviour above, seeded breaks all red).
- [ ] Gates 33/33, each alone; boot the API image (a new controller in `PhotosModule`).
- [ ] Cold code review; four commits (API gate + audit, list route, web-admin, policy), one push.

## Reviews (2026-11-07)

- myclash-plan-review: pass 1, 3 MAJOR (the list's module, the club names' read, the controller helper serving the download) + 3 MINOR, folded; pass 2, 1 MINOR (the shell's baseline entries), folded. CONVERGED, 2 passes.
- Cold plan-reviewer (opus): 0 BLOCKER, 1 MAJOR (the audit actor as a required field), 7 MINOR, 2 NIT; all folded above. Confirmed in code: the gate's catch sees only `ForbiddenException` (`organizations.service.ts:42,609`; the 401 at `:595` passes through); link and rotate call the free `organisersEvent` (`photo-link.service.ts:30,35`); the route scan follows the new gate to `assertOrgRole` (`route-authz-scan.ts:196-227`), so its pins hold; a `PlatformRoleGuard` outside `AdminModule` has a precedent (`privacy-admin.controller.ts:62-64`).
- Named, not fixed: `organizations.service.ts:567` says "A super-admin bypasses every org check"; `assertOrgRole` has no such bypass (a docstring that rotted).
- Approved by the operator (2026-11-07), with the policy line as drafted; the deploy is held until this lands, so the date stays 2026-11-07.

## As built (2026-11-07)

- `fd3886ea` feat(photos): `moderatorsEvent` (`photo-organiser.ts`) and `GatedPhotoEvent` with a required `auditActor`; `recordPlatformWrite` reads the photo (404, no row), writes the row, then the change. 15 tests; 18 breaks red.
- `b853cfe9` feat(photos): `PhotoPlatformController` + `PhotoPlatformService` in `PhotosModule`, `counts()` pulled out of `summary`, `PlatformPhotoEvent` + `PLATFORM_PHOTO_EVENTS_MAX` in types, API client regenerated (578 routes), coverage row (also reserved). 14 breaks red.
- `6d08fbc8` test(photos): the moderation double's seeds in `seededDatabase` (52 lines → under 50).
- `ea20edef` feat(photos): `usePhotoQueue` (`withLink` instead of a second link reader: the link is read in the same snapshot, so the race the cold plan review named cannot happen), `PhotoQueue` + `PhotoUsage` moved to `src/components/photos/`, the two admin pages, the nav item, i18n EN + FR, the shell's baseline re-pointed. 7 breaks red.
- `0a1beb74` docs(legal): the moderators line, FR + EN, version unchanged.
- `686b4e92` fix(photos), after the cold code review (0 BLOCKER, 0 MAJOR, 3 MINOR, 3 NIT): the Event page's 403 reads "Super admin required" (`refusedKey`); the photo-holding read's cut is logged and the photos-on read is newest first; `PHOTO_MODE_LABEL_KEYS` one owner; FR « Approuver »; the staff test asserts no platform read. 7 breaks red (the "Live" word was green until a test named all three modes).
- Deviation from Task 1: the audit row is written after a read of the photo, so a missing photo leaves no row (assumption 8 no longer applies).

## Named, not fixed

- The super admin can **Approve** (make a photo public); the policy line says platform administrators "step in to answer requests and stop abuse", which does not name publishing (cold code review, open question; scope and text both ruled).
- `.in('id', ids)` takes every id of both reads before the 200 cut (up to ~2,000 ids in the URL at the caps); harmless at today's numbers. A SQL function merging, sorting and limiting would remove it.
- No test pins the admin shell's nav list (`SuperAdminShell.tsx` `navSections` is not exported): a dropped `minRole` shows the item to a lower tier, whom the API refuses and the page tells why.
