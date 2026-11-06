# Event photos — slice 6a: a signed-in upload, my photos and delete own, on the server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the operator builds native) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in person can send a photo to one of their own Events without the QR code, under their profile name, list the photos they sent that way, and delete them; the "my events" read carries what the personal-space Photos tab (slice 6b) needs to decide whether it shows.

**Architecture:**

- Migration 0254: `event_photos` gains `uploader_user_id` (an auth uid; the link refuses the account's delete, assumption 11). A photo comes from a phone **or** an account, never both (`device_id` becomes nullable, one CHECK). `event_photo_usage` counts the sender's last hour by device **or** by account.
- `PhotoUploadService.upload` takes a sender (`phone` = token + device, `account` = uid + reader). One door, `admit`, runs each sender's checks in the existing cheapest-first order; the account adds "one of your Events" (the `listMyEvents` read itself) and "your name" (profile, else sign-up name, ruling 458).
- New `MyPhotosController` (`me/events/:eventId/photos`): POST (upload), GET (my photos + the name shown), DELETE `:photoId` (own only, open on an archived Event). The drain request moves into one helper shared with the moderator's delete.
- `GET me/events` gains `event.photoMode` and `hasMyPhotos` per Event.

**Tech Stack:** NestJS 11 + Fastify, PostgREST v14.16 (supabase-js), PG17 migrations, vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-event-photos-design.md`: Goal 11; "Where it shows up" item 5; "Verification" (signed-in upload refused outside one's Events, profile name wins over a sent name, delete own not another's); "Constraints" (registries). Server shape: `2026-11-04-event-photos-slice2a-upload-api.md`, `2026-11-05-event-photos-slice4a-feed-and-report.md`.

**Scripts** (copy into this session's scratchpad, read first): `C:\Users\Tony\AppData\Local\Temp\claude\f--Github-Repo-MyClash\a954b49a-a843-4d0f-92d5-8e55c6ec4e72\scratchpad\` — `gates.sh <ABSOLUTE outdir>`, `replay.sh` (`KEEP=1`, port 55471), `live-4c.cjs` + `seed-4c.sql`, `falsify-4c.mjs`, `boot-4c.sh` + `boot-4c-calls.cjs`, `baseline-audit.mjs`, `watch-ci.sh`.

## In plain words

Today only a phone that scanned the QR code can send a photo, and the photo remembers nothing about who sent it except a random phone id.

After 6a (the server only; 6b adds the screen): Léa, signed in, can send a photo to an Event she fights, referees, teaches or takes a workshop at. No QR code is needed. The photo carries her fighter-profile name ("Léa Martin"), or the name she typed when she created her account if she has no profile; never her email. If she sends another name, it is ignored. If she has neither name, the photo is refused with "Your photos carry your name: add one to your profile first."

The same rules as the QR code apply: photos must be on, the upload days must be open, Approve-first photos wait, and the Event's hourly and storage caps count her photos too. Her own limit is 20 photos an hour for that Event, counted on her account, not her phone.

She can list the photos she sent this way (waiting or shown) and delete any of them, even after the Event is archived. She cannot delete anyone else's: for her, another person's photo does not exist. If she deletes her account, her photos are deleted too, and so they are when the super admin anonymises her profile.

If the database hiccups while she sends, she reads "Photos are unavailable right now, try again", never "not your event". The "my events" list itself now fails loudly on a hiccup instead of quietly showing fewer Events (the "could not load, retry" message on the screen comes with 6b).

A photo she sends with the QR code stays anonymous, as today: it is not in her list.

The "my events" list now also says, per Event, whether photos are on and whether she has photos there. 6b uses that to show the Photos tab.

## Operator rulings for this slice

- **458** (2026-11-06 ~04:20) Story: Léa, signed in, sends a photo from her personal space; it always shows a name. Ruling: **her fighter-profile name; with no profile, the name she typed at sign-up; never her email.**
- **459** (~04:20) Story: slice 6 has a server half and a page half. Ruling: **two commits, 6a server then 6b the Photos tab.**
- **460** (~04:20) Story: the 4c gap (an edited report comment cleared unseen by a stale Keep). Ruling: **fix it later, in its own small slice after slice 6.**
- **461** (~04:35, from the cold plan review) Story: the database hiccups while Léa opens her personal space; today a "my events" read that fails is read as "none", so she sees fewer Events, and the upload would tell her "not your event". Ruling: **fail loudly everywhere**: the reads behind "my events" throw on an error; the upload answers "photos are unavailable, try again"; the personal space shows a "could not load, retry" message (6b: today no page reads the hook's `error`, `apps/web-public/src/components/me/hooks.ts:9-35`, so until 6b a failed read still shows no Events).
- **462** (~04:35, from the cold plan review) Story: Léa asks to be forgotten; the super admin anonymises her profile; her photos would still say "Léa Martin" publicly until day 31. Ruling: **anonymising deletes the photos she sent from her personal space.**

## Assumptions (mine; the operator reads them before the build)

1. **Neither name → refused**, with a new code `photo_no_name` ("Your photos carry your name: add one to your profile first."). The sign-up name exists only for organiser accounts (`signup.dto.ts:50`); a fighter who signed in by email link or Google and never made a profile has neither. The sign-up name is one its owner can change herself, as the QR page's name box.
2. **The whole name is kept, up to 200 characters** (the profile's own limit, `fighters.dto.ts:8`). The 40-character limit stays for a name typed on the QR page. A stored name longer than 200 (an old import) is cut at 200.
3. **The name is copied when the photo is sent.** A profile renamed later does not rename old photos.
4. **"One of your Events" is exactly the "my events" list** (`listMyEvents`): the same read answers both, so they cannot disagree. It lists archived Events and drafts she may see, never test Events (so the operator's `test`-kind Event takes no signed-in photo), a withdrawn fighter's Event (her claimed roster row, `me-events.service.ts:388`), and a Workshop she is waitlisted for (`:839`). The upload's own rules (photos on, upload days open, the archived lock) refuse the rest. It costs the whole list read (~15 reads) per photo, before the slot: accepted at 20 photos an hour per account.
5. **Checks run cheapest first:** photos on, upload days open, then "one of your Events", then the name, then the bucket, a processing slot and the caps. A person who is not at the Event, on an Event with photos off, hears "photos are off" (the mode is public anyway).
6. **Her limit is per account per Event**, 20 an hour, its own code `photo_account_limit` ("You have sent your photos for this hour. Try again later."), not the phone's sentence.
7. **"My photos" lists the photos she sent from her personal space for that Event, newest first, 30 at a time with Load more**, as the public page (PostgREST answers at most 1000 rows, `PGRST_DB_MAX_ROWS`, `infra/docker-compose.prod.yml:551`, so a one-read list could be cut silently). Each shows its status, caption, tag, time, and both images, **including a waiting one**: she sees her own photo before approval.
8. **Delete is open after archive** (as the organiser's, for privacy) and needs no membership: a person who left the Event can still delete her photos. Another person's photo, a QR photo, or a photo of another Event answers "not found".
9. **Delete is the moderator's delete**: the row goes, its images are queued for removal at once (not awaited), and its reports go with it.
10. **The tab's data:** `GET me/events` gives each Event `photoMode` (null when unknown) and `hasMyPhotos`. `getUpcoming` and the workshop history carry `photoMode` too (one mapper), unused there.
11. **Erasure:** her photo rows are deleted with her account by `deleteOwnedRows` (the erasure owner, run before the account goes, `auth.service.ts:1488-1500`). The account link is a plain foreign key that **refuses** to delete an account that still has photos, never a cascade: a cascade from GoTrue's delete would fire the photo table's delete trigger as GoTrue's own role, which may not write the deny-all tombstones (0250:19-22), so it would break account deletion or need a definer function. A photo landing between the erasure and the account delete makes the delete fail loudly; the retry erases it. Anonymising her profile deletes them too (462). Her personal-data export lists her photo rows (not the images) in `photos.csv`.
12. **A third "account → name" reader.** Two exist (`user-directory.service.ts:26-87`, `events.service.ts:569-618`): both put first + family name first and swallow errors. Ruling 458 (profile name first) and 461 (a failure is loud) need their own; `accountPhotoName` is the photos' one owner.

## As built: the plan reviews, folded

- `myclash-plan-review` converged in 3 passes (pass 1: 3 MINOR, 1 NIT; pass 2: 1 MAJOR, PostgREST's 1000-row cap, `PGRST_DB_MAX_ROWS`, made the list paged and the "has photos" read per recent Event; pass 3 clean).
- Cold `plan-reviewer` (opus): 0 BLOCKER, 3 MAJOR, 9 MINOR, 1 NIT, all folded. MAJOR: the "my events" reads swallow errors, so a hiccup read as "not your event" (ruling 461); a cascade from the auth server's account delete would fire the tombstone trigger as a role that may not write tombstones (the link now refuses instead, and the probe deletes as a GoTrue-like role); anonymising a profile left the name on her photos (ruling 462). MINOR: all six baseline entries move; two hand-kept upload registries; an empty-list stub that holds nothing; db tests that read 0249's text; a missing `NOTIFY pgrst`; the per-upload read cost (named); a DTO 400 a direct call cannot see; `GET me/events` failing on a photo read (461); a third "account → name" reader (named). NIT: two unused selects dropped. Its open question on the trigger's role is settled by the probe either way: the design no longer depends on it.

## As built: the build

- Done as planned, native on `main`, one commit, with these rulings:
  - **Ruling 461 covers the six reads that decide which Events are listed** (claimed roster rows, the profile, referee duties, workshop enrolments, both teaching reads). Two of them also open `/me/upcoming`, `/me/leagues`, `/me/workshop-history` and `/me/instructor-workshops`, which now answer a failure instead of an empty list (tested). The detail reads (skills, Swiss rounds, bout counts, registrations, pool members) still swallow errors: named, not fixed.
  - The sign-up name is read through a new bounded `readAccount` (`auth-server-calls.ts`, `heldToLimit`); `photosUnavailable` moved to `photo-refusals.ts`; the tag mapping to `photo-tag.ts` (`photoTag`, the moderator's and hers); the drain request to `photo-drain.ts`.
  - The probe holds **74** checks (7 new, `scripts/lib/photo-account-probe.mjs`), one more than planned: a 201-character account name is refused.
  - `GET me/events` got a controller test (nothing pinned that it calls `withOwnPhotos`).
- Proof: 49 seeded breaks, all red, counts stable per suite (the three EN-key rows first read a stale `dist`: renaming an EN key breaks the i18n build, so they now run the package's own check). Live PostgREST v14.16 over the replayed PG17, 10/10. Replay + RLS, merge and cascade probes green. The image boots (no module cycle); signed out, the list, the delete and `GET me/events` answer 401, a bad cursor 400. The signed-out upload answers 500 there: the archived-Event lock reads the Event before the handler and that boot has no database (it fails closed, `resolve-event-id.ts` `rowsOf`), as the QR route does.
- Cold code review (opus): 0 Critical, 3 Important, all fixed test-first: the anonymise read now throws on an error (it skipped the photo delete in silence); the name read logs its cause before its 503; the four other `/me` lists are tested. Minor, fixed: a test name that claimed more than it checked, the probe's 201 bound, the docs drift, "Events" capitalised. Minor, deferred: `withOwnPhotos` runs its reads unbounded in parallel (only Events before their deletion instant); the list answers 503 when only the name read fails; a time tie at a page edge drops a photo (as the public feed). For the operator: a rostered referee with no duty yet is not in "my events", so cannot send; a person who left the Event can delete her photos on the server, but 6b's tab lives in the hub of listed Events; the privacy texts name no photos (slice 8).

## Global Constraints

- RLS: `event_photos` stays deny-all (no policy); writes as the service role (0247).
- Every new string EN + FR (`packages/i18n`), rebuilt into `dist` before an app test reads it.
- No real photos or personal data in fixtures (synthetic JPEG only, `testing/synthetic-jpeg.ts`).
- Functions < 50 lines, files < 400 lines (specs and tests too); only entries shifted by an edit are re-pointed in `docs/code-quality-complexity-baseline.json`, audited with `baseline-audit.mjs`.
- Selects are whole literals per branch (the schema-conformance sweep skips a built one).
- `@myclash/types` is read from `dist`: `pnpm --filter @myclash/types build` after editing it.
- Migration `0254_event_photo_account.sql` (max+1; re-check `ls packages/db/migrations | tail -1` before commit).
- One commit for 6a, Conventional Commits header ≤ 100 characters, lower-case subject.

## Review Focus

1. A person who is on an Event only as a withdrawn fighter: `listMyEvents` still lists it (claimed roster row, `me-events.service.ts:388`), so she may upload. A property of `listMyEvents`, not of the upload (whose test takes the list's word); named for the operator in assumption 4.
2. A sent `name` field on the account route is ignored even when it is longer than 40 (no `photo_text_too_long`). Task 3 test.
3. The QR route keeps working unchanged for a signed-in person: no `uploader_user_id`, the device cookie still counts (Task 3 test "the phone path stores no account").
4. A delete of a photo id that belongs to another person, to a QR upload, or to another Event answers 404 and deletes nothing (Task 4 tests, each filter asserted).
5. A failed read — GoTrue down while reading the sign-up name, the profile read, or any read behind "my events" — gives a 503 `photos_unavailable`, never "no name" or "not your event" (Task 2 and Task 3 tests; 461).

---

### Task 1: Migration 0254, the registries, the usage function

**Files:**

- Create: `packages/db/migrations/0254_event_photo_account.sql`
- Modify: `packages/db/test/event-photos.test.ts` (133 lines; new `describe('0254 …')`)
- Modify: `apps/api/src/modules/privacy/subject-export.tables.ts` (`event_photos` entry), `apps/api/src/modules/privacy/erasure.service.ts:99-108` (`OWNED` += `['event_photos', 'uploader_user_id']`) and `:172-204` (`anonymiseGlobalPerson` reads `claimed_by_user_id` with the slug and, when set, deletes `event_photos` by `uploader_user_id`, counted as `counts['event_photos']`; 462)
- Modify: `scripts/lib/photo-tombstone-probe.mjs` (+ account checks), `scripts/db-cascade-probe.mjs` if the check count is pinned there

**Interfaces:**

- Produces: column `event_photos.uploader_user_id uuid NULL REFERENCES auth.users(id)` (no `ON DELETE` action: refuses; assumption 11); `device_id uuid NULL`; function `event_photo_usage(p_event_id uuid, p_device_id uuid, p_user_id uuid DEFAULT NULL) RETURNS TABLE(event_last_hour int, event_bytes bigint, sender_last_hour int)`.

**Migration content:**

- `ALTER TABLE public.event_photos ADD COLUMN IF NOT EXISTS uploader_user_id uuid REFERENCES auth.users(id);` + `COMMENT ON COLUMN` ("The account that sent it from its personal space (Goal 11); null for a QR photo. An auth uid, never a person id. No cascade: erasure deletes these rows first (deleteOwnedRows); a cascade from the auth server's delete would fire the tombstone trigger as a role that may not write tombstones.").
- `ALTER COLUMN device_id DROP NOT NULL`; comment updated ("null for an account's photo").
- `CONSTRAINT event_photos_one_sender CHECK (num_nonnulls(device_id, uploader_user_id) = 1)`, `NOT VALID` then `VALIDATE` (0162 style).
- Name: drop the 0249 inline column CHECK **by its name, with no `IF EXISTS`** (a wrong name must fail the replay, not pass in silence). Read the name from the replayed schema first: `select conname from pg_constraint where conrelid='public.event_photos'::regclass and pg_get_constraintdef(oid) like '%uploader_name%'` (expected `event_photos_uploader_name_check`). Add `event_photos_uploader_name_len CHECK (uploader_name IS NULL OR char_length(uploader_name) BETWEEN 1 AND CASE WHEN uploader_user_id IS NULL THEN 40 ELSE 200 END)`. Then read the CHECK back after replay (memory: a CHECK drop can fail silently on PG17).
- Index `event_photos_uploader_idx ON public.event_photos (uploader_user_id, event_id, created_at DESC) WHERE uploader_user_id IS NOT NULL` (the cascade, the limit and the list).
- `DROP FUNCTION public.event_photo_usage(uuid, uuid);` then `CREATE FUNCTION public.event_photo_usage(p_event_id uuid, p_device_id uuid, p_user_id uuid DEFAULT NULL)`, same `LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_catalog`, `sender_last_hour = count(*) FILTER (WHERE (device_id = p_device_id OR uploader_user_id = p_user_id) AND created_at > now() - interval '1 hour')`; the same REVOKE/GRANT lines as 0249:72-73, for `(uuid, uuid, uuid)`.
- Last line: `NOTIFY pgrst, 'reload schema';` (as 0250:96): a PostgREST left running knows only the two-argument function until it reloads (PGRST202).

- [ ] **Step 1: Write the failing db tests** in `packages/db/test/event-photos.test.ts`. The helpers read every migration as one text (`migration-sql.ts:33-36`), where 0249's text stays: assert 0254's own statements and their order with `lastIndex` (the drop of `event_photos_uploader_name_check` comes after 0249's CHECK; the `(uuid, uuid, uuid)` grant after the drop of `(uuid, uuid)`), never a bare "contains". Tests: `it('links a photo to the account that sent it, and refuses to lose it in a cascade')` (column + `REFERENCES auth.users(id)` with no `ON DELETE` on that line); `it('takes a photo from a phone or an account, never both')` (`num_nonnulls(device_id, uploader_user_id) = 1`, `device_id` `DROP NOT NULL`); `it('lets an account name run to 200, a typed name to 40')`; `it('counts the sender by device or by account, away from web roles')` (`p_user_id uuid DEFAULT NULL`, `sender_last_hour`, REVOKE/GRANT, `SECURITY INVOKER`).
- [ ] **Step 2: Run** `pnpm --filter @myclash/db test -- event-photos`. Expected: FAIL (no 0254).
- [ ] **Step 3: Write the migration and the registry entries.** Subject export: `event_photos: { reaches: [{ column: 'uploader_user_id', reach: 'uid' }], file: 'photos.csv' }` with a comment (her own contribution; the images are not exported; QR photos name nobody). Erasure: the `OWNED` tuple (its doc comment lists "contributions" too).
- [ ] **Step 4: Probe checks** in `photo-tombstone-probe.mjs` (`EXPECTED_CHECKS` is `scripts/db-cascade-probe.mjs:71`): as the disposable DB's owner, insert an `auth.users (id)` row (the replay's stub table, `packages/db/fixtures/supabase-baseline.sql:36-40`) and one photo with `uploader_user_id`; if the photo is seeded under `session_replication_role = replica`, set it back to `origin` BEFORE the user delete, or neither the cascade nor the tombstone trigger fires. Then: (a) deleting the user **as a role that owns nothing, does not bypass RLS and has no grant on `public`** (a probe role standing for GoTrue's `supabase_auth_admin`, `infra/docker-compose.prod.yml:233`) is refused with `23503` and the photo stays; (b) the erasure path, a service-role (`asService`) delete by `uploader_user_id`, removes the photo and tombstones both keys, after which the user delete succeeds; (c) a row with both or neither sender is refused (`23514`); (d) a 41-character name with no account is refused, a 200-character one with an account is kept. Update the pinned count (67 → 72).
- [ ] **Step 4b: Anonymise test** in the erasure tests: `'anonymising a claimed profile deletes the photos its account sent'` (delete filter `uploader_user_id = <claimed uid>`, `counts.event_photos`); `'an unclaimed profile deletes no photo'` (no delete call).
- [ ] **Step 5: Verify**, each must pass: `pnpm --filter @myclash/db test`; `pnpm db:review`; `pnpm --filter @myclash/api exec vitest run src/modules/privacy src/modules/exports`; `replay.sh` with `KEEP=1` (replay, rls-probe, merge-probe, `CASCADE_PROBE_DISPOSABLE=1` cascade-probe = 71); schema read: `\d event_photos` shows the column, both CHECKs by name, the index; `select pg_get_function_arguments('public.event_photo_usage'::regproc)` names `p_user_id uuid DEFAULT NULL::uuid`; `select has_function_privilege('anon', 'public.event_photo_usage(uuid,uuid,uuid)', 'execute')` → `f`.

---

### Task 2: The account's photo name

**Files:**

- Create: `apps/api/src/modules/photos/photo-account.ts`, `apps/api/src/modules/photos/photo-account.test.ts`
- Modify: `packages/types/src/event-photos.ts` (`PHOTO_ACCOUNT_NAME_MAX = 200`; refusal codes `photo_not_your_event`, `photo_no_name`, `photo_account_limit` appended to `PHOTO_UPLOAD_REFUSALS`)
- Modify: `apps/web-public/src/lib/photos/photo-refusal.ts` (the three `REFUSALS` rows: `notYourEvent` `closed`, `noName` `closed`, `accountLimit` `closed`) and its test's `STATUS` / `END` records, `packages/types/src/event-photos.test.ts:30-31` (16 → 19 codes), `packages/i18n/src/messages/{en,fr}/publicApp.ts` (`photoSend.refusal.notYourEvent`, `.noName`, `.accountLimit`)

**Interfaces:**

- Produces: `accountPhotoName(supabase: SupabaseService, userId: string): Promise<string | null>` — the profile's `display_name` (`global_persons.claimed_by_user_id = userId`), else `user_metadata.display_name` from `supabase.service.auth.admin.getUserById(userId)`; trimmed; empty → next source; cut to `PHOTO_ACCOUNT_NAME_MAX` code points; never the email. A read error from either source throws the upload's `unavailable()` (503 `photos_unavailable`): export `photosUnavailable()` from `photo-upload.service.ts`'s `unavailable` (renamed, moved to `photo-account.ts` or a shared `photo-refusals.ts` if both files need it).

- [ ] **Step 1: Write the failing tests** (`photo-account.test.ts`, `mockSupabase` + an `auth.admin.getUserById` stub): `'the profile name wins'` (both present → `'Léa Martin'`, `getUserById` never called); `'the sign-up name when there is no profile'`; `'a blank profile name falls through to the sign-up name'`; `'never the email'` (no profile, metadata `{}`, user `email: 'lea@example.test'` → `null`); `'a name past 200 is cut at 200 characters, not bytes'` (201 × `'é'` → 200 × `'é'`); `'a failed profile read is unavailable, not nameless'` and `'GoTrue failing is unavailable, not nameless'` (each → 503 with `code: 'photos_unavailable'`); assert the select string `'display_name'` and the `.eq('claimed_by_user_id', uid)` filter (`selectsFor`, `filtersFor`).
- [ ] **Step 2: Run** `pnpm --filter @myclash/api exec vitest run src/modules/photos/photo-account`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement**, then the types, the three refusal rows and the six i18n strings. EN: notYourEvent "You can send photos here only to your own events.", noName "Your photos carry your name: add one to your profile first.", accountLimit "You have sent your photos for this hour. Try again later." (no number, as `deviceLimit`, `publicApp.ts:1453`: a changed cap would make it lie). FR: "Vous ne pouvez envoyer des photos ici qu'à vos propres événements.", "Vos photos portent votre nom : ajoutez-en un à votre profil d'abord.", "Vous avez envoyé vos photos pour cette heure. Réessayez plus tard."
- [ ] **Step 4: Verify** the test passes; `pnpm --filter @myclash/types build && pnpm --filter @myclash/i18n build`; `pnpm --filter @myclash/web-public test photo-refusal`; the i18n key tests (`pnpm --filter @myclash/i18n test`, directly: turbo caches it).

---

### Task 2b: The "my events" reads fail loudly (ruling 461)

**Files:**

- Modify: `apps/api/src/modules/me/me-events.service.ts` — `fetchClaimedPersons` (`:608-623`), `resolveGlobalPersonId` (`:625-632`), `fetchRefereeAssignments` (`:656-658`, warn → throw), `fetchWorkshopEventIds` (`:829-849`), `fetchInstructorEventIds` (`:863-919`, both reads): each throws a plain `Error` naming the read ("My events: claimed persons not read: …", with PostgREST's message) on a read error. Count each edited function before and after; the baselined ones (`:635`, `:863`) only re-point.
- Test: `apps/api/src/modules/me/me-events.list.test.ts` (or a new `me-events.read-failure.test.ts` if that file passes 400)

- [ ] **Step 1: Write the failing tests:** one per read, `'a failed <what> read fails the list, never shortens it'` — the double answers `{ data: null, error: { message: 'boom' } }` for that table only → `listMyEvents` rejects. And `getUpcoming` rejects too (it shares the fetchers).
- [ ] **Step 2: Run** `pnpm --filter @myclash/api exec vitest run src/modules/me`. Expected: FAIL (each read is swallowed today).
- [ ] **Step 3: Implement**; existing `me` tests stay green.

---

### Task 3: The upload takes a sender

**Files:**

- Modify: `apps/api/src/modules/photos/photo-upload.service.ts` (287 lines: `upload` 37, `checkLimits` 22, `receive` 36)
- Modify: `apps/api/src/modules/photos/photos.controller.ts:90-97` (the QR route builds a `phone` sender)
- Modify: `apps/api/src/modules/photos/photo-moderation.service.ts:257-268` (`usage` reads `event_last_hour`, `event_bytes` only: unchanged names; confirm no `device_last_hour` read)
- Modify: `apps/api/src/modules/me/me.module.ts` (`exports: [MeEventsService]`; comment: PhotosModule imports it, MeModule imports nothing of photos), `apps/api/src/modules/photos/photos.module.ts` (`imports += MeModule`)
- Test: `apps/api/src/modules/photos/photo-upload.account.test.ts` (new; the 365-line `photo-upload.service.test.ts` takes only the arg rename)
- Modify: the service's constructor callers, which gain the `MeEventsService` argument: `testing/photo-door.ts:47`, `photo-upload.service.test.ts:84`.
- Modify: the two hand-kept upload registries nothing scans: `apps/api/src/common/upload-limits.routes.test.ts` (a cell for `POST me/events/:eventId/photos`, `PHOTO_UPLOAD`, count 15 → 16, `:54`, `:170-171`) and `upload-limits.refuse-first.test.ts:23-36` (the route refuses before reading).
- Modify: the two doubles that answer the usage read, `testing/photo-door.ts:40` and `testing/moderation-doubles.ts:97` (`device_last_hour` → `sender_last_hour`). A default left under the old name reads `undefined` in the new code, and `undefined >= 20` is false: every limit test would pass with the limit gone.

**Interfaces:**

- Consumes: `accountPhotoName` (Task 2), `MeEventsService.listMyEvents(reader: PublicReader): Promise<MyEvent[]>`.
- Produces: `type PhotoSender = { kind: 'phone'; token: unknown; deviceId: string } | { kind: 'account'; reader: PublicReader }`; `upload(eventId: string, sender: PhotoSender, req: FastifyRequest): Promise<{ id: string; status: 'waiting' | 'approved' }>`; constant `ACCOUNT_PHOTOS_PER_HOUR = 20`.
- Internal: `admit(event, sender): Promise<PhotoSource>` where `PhotoSource = { device_id: string; uploader_user_id: null; name: null } | { device_id: null; uploader_user_id: string; name: string }` (name null = read the typed field). Order: phone → token; both → mode, window; account → `listMyEvents(...).some(e => e.event.id === event.id)` else 403 `photo_not_your_event` (a rejected `listMyEvents` → 503 `photos_unavailable`, logged), then `accountPhotoName` else 403 `photo_no_name`. `upload` keeps: read event, `admit`, bucket, slot, `checkLimits(event.id, source)`, `receive(event, source, req, store)`. `checkLimits` sends `p_device_id: source.device_id, p_user_id: source.uploader_user_id` and refuses `sender_last_hour` with `photo_device_limit` or `photo_account_limit` by source. `receive` stores `uploader_name: source.name ?? textField(fields['name'], PHOTO_NAME_MAX)`, `device_id`, `uploader_user_id`.

- [ ] **Step 1: Write the failing tests** in `photo-upload.account.test.ts` (doubles from `testing/photo-door.ts`, `synthetic-jpeg.ts`; a `listMyEvents` stub):
  - `'a member sends a photo under her profile name; the sent name is ignored'` — fields `name: 'x'.repeat(60)` → insert row `uploader_name: 'Léa Martin'`, `uploader_user_id: 'uid-1'`, `device_id: null`.
  - `'a member through a claimed roster row only may send'` — `listMyEvents` returns the Event with all roles false.
  - `'refuses an Event outside her own Events, before the file is read'` — the stub lists TWO other Events (an empty list would let a `length > 0` check pass); 403 `photo_not_your_event`, the request body never consumed (the door helper's "file never asked for" assertion), no rpc.
  - `'a failed membership read is unavailable, not "not your event"'` — `listMyEvents` rejects → 503 `photos_unavailable`.
  - `'refuses with no name, before the file is read'` — 403 `photo_no_name`.
  - `'photos off and a closed window refuse before the membership read'` — `listMyEvents` not called.
  - `'counts her last hour by account'` — rpc args `{ p_event_id, p_device_id: null, p_user_id: 'uid-1' }`; `sender_last_hour: 20` → 429 `photo_account_limit`.
  - `'the phone path stores no account'` (QR sender) — row `uploader_user_id: null`, rpc `p_user_id: null`; `sender_last_hour: 20` → 429 `photo_device_limit`.
  - `'Approve first: her photo waits'` — mode `approve` → `status: 'waiting'`.
- [ ] **Step 2: Run** `pnpm --filter @myclash/api exec vitest run src/modules/photos/photo-upload`. Expected: the new file FAILs; fix the old file's rpc expectation (`p_user_id: null`, `sender_last_hour`) as part of Step 3.
- [ ] **Step 3: Implement.** Count each function after the edit (`upload` < 50, `admit` < 50). Add `MeModule` to `PhotosModule.imports` and export `MeEventsService`; boot proves no cycle (Task 5).
- [ ] **Step 4: Verify:** `pnpm --filter @myclash/api exec vitest run src/modules/photos` green.

---

### Task 4: The routes — upload, my photos, delete own; the drain helper; `GET me/events`

**Files:**

- Create: `apps/api/src/modules/photos/my-photos.controller.ts`, `apps/api/src/modules/photos/my-photos.service.ts`, `apps/api/src/modules/photos/my-photos.test.ts`, `apps/api/src/modules/photos/photo-drain.ts`
- Modify: `apps/api/src/modules/photos/photo-moderation.service.ts:192-207` (`remove` calls `requestDrain`)
- Modify: `apps/api/src/modules/photos/photos.module.ts` (controller + provider)
- Create: `apps/api/src/modules/me/me-event-photos.ts` (+ test); Modify: `apps/api/src/modules/me/me-events.service.ts` (`MyEventInfo.photoMode: PhotoMode | null`; `mapEvent` `photoMode: asPhotoMode(row['photo_mode'])`; `photo_mode` added to the 5 literal `events ( … )` selects that feed `listMyEvents` and `getUpcoming`, at 614, 644, 836, 874, 881; the workshop-history selects at 1096 and 1224 stay, their `photoMode` reads `null`), `apps/api/src/modules/me/me.controller.ts` (`events` route; `me.module.ts:9`'s "only AppModule imports MeModule" comment updated)
- Modify: `packages/types/src/event-photos.ts` (`MyPhoto`, `MyPhotos`)
- Modify: `apps/api/src/common/event-readonly/archived-lock.routes.test.ts` (exact list += `'DELETE me/events/:eventId/photos/:photoId'` with a reason; `placed` 190 → 192, history comment)
- Regenerate: the OpenAPI client (`pnpm --filter @myclash/api build`, then `pnpm openapi:client`)

**Interfaces:**

- Produces (types): `MyPhoto = Pick<ModerationPhoto, 'id' | 'status' | 'caption' | 'tag' | 'createdAt' | 'previewUrl' | 'originalUrl'>`; `MyPhotos = { posterName: string | null; photos: MyPhoto[]; next: string | null }` (`next` as `PublicPhotoPage.next`).
- Produces (routes, `@Controller()`, `@ApiTags('me')`, `@ApiCookieAuth('sb-access-token')`, each starts with `requireRequestUserId(req, this.supabase)`):
  - `POST me/events/:eventId/photos` (201, multipart; `ParseUUIDPipe`; `@ApiConsumes`, `@ApiBody` like the QR route minus `name`) → `uploads.upload(eventId, { kind: 'account', reader: { userId, staff: getStaffSession(req) } }, req)`. Placed by its `eventId`: refused on an archived Event, as the QR route.
  - `GET me/events/:eventId/photos?before=` → `MyPhotos`. Query DTO `MyPhotoQueryDto` (`{ before: z.iso.datetime({ offset: true }).optional() }`, strict) in `photo-public.dto.ts` beside the public one.
  - `DELETE me/events/:eventId/photos/:photoId` (204, `@AllowOnArchivedEvent()`).
- `MyPhotosService.list(eventId, userId, before?: string): Promise<MyPhotos>` — one literal select `'id, status, caption, created_at, preview_key, original_key, tournament:tournaments(name), workshop:workshops(title)'`, `.eq('event_id').eq('uploader_user_id', userId)`, `.lt('created_at', before)` when given, `.order('created_at', { ascending: false }).limit(PUBLIC_PHOTO_PAGE)`; `next` = the last row's `created_at` when the page is full, else null (the feed's rule, `photo-public.service.ts:100-101`); links through `photoLinks`; `posterName: await accountPhotoName(...)`.
- `MyPhotosService.remove(eventId, photoId, userId): Promise<void>` — `.delete().eq('id').eq('event_id').eq('uploader_user_id', userId).select('id')`; empty → `photoNotFound()`; then `requestDrain`.
- `requestDrain(queue: Queue, logger: Pick<Logger, 'warn'>, photoId: string): void` — the body moved verbatim from `remove` (not awaited, `.catch` logs).
- `withOwnPhotos(db, events: MyEvent[], userId: string, now: Date): Promise<(MyEvent & { hasMyPhotos: boolean })[]>` — only an Event whose `photoDeletionInstant({ end_date: endDate, timezone })` is in the future can hold a photo (rows are deleted at that instant), so only those are asked, each with one read `event_photos.select('id').eq('event_id', id).eq('uploader_user_id', userId).limit(1)`, in parallel; every other Event is `false` with no read. (One `in('event_id', ids)` read could be cut at PostgREST's 1000 rows and drop an Event silently.) A read error throws. An Event with no end date has no deletion instant: asked (its photos are never expired).

- [ ] **Step 1: Write the failing tests** (`my-photos.test.ts`, the controller through its handlers with `mockSupabase`):
  - `'lists only her photos of this Event, newest first, waiting ones included, with the name shown'` — assert the select string verbatim and the three filters (`filtersFor`); seed rows in reverse to prove `.order`.
  - `'pages by 30 from before'` — 30 rows → `next` = the 30th's `created_at`; `before` → an `lt created_at` filter; 29 rows → `next: null`. A bad `before` is refused by `myPhotoQuerySchema.safeParse` (a direct handler call runs no pipe).
  - `'deletes her own photo and asks for a drain'`; `'another person's photo, a QR photo or another Event's is not found and nothing is deleted'` — 404 `photo_not_found`, filters include `uploader_user_id = uid` and `event_id`.
  - `'signed out → 401 on all three'`.
  - `me-event-photos.test.ts`: `'marks the Events where she has photos'`; `'an Event past its deletion instant is false with no read'`; `'an Event with no end date is asked'`; `'reads nothing for no Events'`; select string `'id'` and both filters asserted.
  - `me-events.list.test.ts`: one row with `photo_mode: 'live'` → `event.photoMode === 'live'`; an unknown mode → `null`.
  - `photo-moderation.writes.test.ts`: the drain is still asked for (existing test stays green).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** `MyEventInfo` gains a line at `:39-49` and the import on `:22` may wrap: all six `me-events.service.ts` entries in the baseline (`:281, :336, :635, :863, :1081, :1213`) re-point, nothing else; audit with `baseline-audit.mjs`. `withOwnPhotos` throwing makes `GET me/events` fail on a photo read error: that is ruling 461.
- [ ] **Step 4: Verify:** `pnpm --filter @myclash/api exec vitest run src/modules/photos src/modules/me src/common` — `route-authz.test.ts` gives the three handlers `self` (path has `me`, `requireRequestUserId` throws 401) with UNDECIDED 0, DECIDED_ELSEWHERE 19, FALSE_PASSES 0 unchanged; `public-routes.test.ts` unchanged; `archived-lock.routes.test.ts` 192; `db-schema-conformance.test.ts` reads the new selects.

---

### Task 5: Live proof, falsify, review, gates, commit

- [ ] **Live PostgREST v14.16 over the replayed DB** (`live-4c.cjs` recipe): `rpc('event_photo_usage', { p_event_id, p_device_id: null, p_user_id })` returns `sender_last_hour` for an account's rows only; the moderator's call with only two arguments still resolves (`DEFAULT NULL`); the my-photos select with both embeds answers; the delete filter on `uploader_user_id` deletes one row.
- [ ] **Falsify** (copy `falsify-4c.mjs` → `falsify-6a.mjs`; Prettier first, anchors after it): drop the membership check; drop the name override (`source.name ??`); swap name sources; return the email; drop `uploader_user_id` from the delete filter; drop `event_id` from it; drop `p_user_id` from the rpc; refuse with the phone code for an account; drop `requestDrain` from the own delete; drop `photo_mode` from `mapEvent`; `hasMyPhotos` always true; drop the deletion-instant skip; drop the list's `.limit` or its `before` filter; drop the list's `uploader_user_id` filter; drop `withOwnPhotos`' `uploader_user_id` filter; compare membership by the wrong id (`e.event.slug`); swallow one "my events" read error again (one row per read); turn the membership failure into `photo_not_your_event`; drop the anonymise delete; drop the OWNED tuple; drop the subject-export entry; each refusal row/key. Each must go RED with the collected count unchanged.
- [ ] **Image boot** (`boot-4c.sh` → `boot-6a.sh`): the API boots (no module cycle); `POST/GET/DELETE me/events/<uuid>/photos…` with no session → 401; `GET me/events` → 401.
- [ ] **Cold code review** (`code-architecture-reviewer`, opus), fold or name each finding.
- [ ] **Gates:** `gates.sh <ABSOLUTE outdir>` 33/33 (stop any `next dev` first).
- [ ] **Docs:** the design's Goal 11 gains a `[rev 458, slice 6a]` line (name order, the 200 limit, refusal with no name); this plan's "As built".
- [ ] **Commit:** `git fetch`, `git log --oneline -1`, `git status --short`; stage the explicit list; `git diff --cached --stat`; message via the Write tool: `feat(photos): a signed-in upload to one's own events, my photos and delete own, on the server`. Push; `watch-ci.sh <full sha>`.

---

## Slice 6b, in outline (its own plan after 6a ships)

- `HubTab` += `'photos'` (`EventHubChrome.tsx:10`); the tab and the `MyEventsNav` link show when `photosShown(event.photoMode) || hasMyPhotos`. Route `app/me/events/[eventSlug]/photos/` (title layout, a server page reading the tags with `readPhotoTags`, a client body).
- The form reuses the QR page's queue (`send-queue`, `busy-retry`, `PhotoQueue`, `TagOptions`, `refusalView`); `sendPhoto` takes a target (`me/events/:id/photos`, no token) instead of a token; the name box becomes "Posted as «name»" from `MyPhotos.posterName`; the form shows only when photos are on.
- "My photos" below, 30 at a time with Load more, each tile with its status and Delete (asks first, `useConfirm`).
- Ruling 461 on the screen: the "my events" list and the hub read `useMyEvents().error` and show a "could not load, retry" line (today no page reads it).
- `apiRequest` files every 403 as `unauthenticated` (`photo-refusal.test.ts:51-58`): the form must read the code first, so `photo_not_your_event` / `photo_no_name` never send her to `/login`.
- Tests: jsdom for the pieces, Playwright `tests/a11y/me-photos.spec.ts` with `page.route` for the three routes and `me/events`.
