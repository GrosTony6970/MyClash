# Event photos — design

> On approval this design is copied to `docs/superpowers/specs/2026-11-03-event-photos-design.md`
> and committed, then `superpowers:writing-plans` turns it into the build plan.
> Reviewed by `myclash-plan-review` on 2026-11-04 (2 passes, converged); operator rulings Q1-Q3 folded in.

> Changes from the original are marked **[rev]**. "(my call)" marks a choice the operator did not make.

## Context — why

People at a HEMA Event take photos all day, and those photos stay on their phones. The operator wants
them on the public Event page, so a friend at home can follow the day as it happens. The photos are
short-lived: they tell the story of the Event and are not an archive. Cost must stay low.

## What success looks like

1. A spectator scans a QR code on a venue poster.
2. They pick a photo and can add a name, a caption and a Tournament or Workshop. They tap Send.
3. A few seconds later, or once a moderator approves it, the photo shows at the top of the "Photos"
   section of the public Event page.
4. **[rev]** At 00:00 on the 31st day after the Event's last day (on the Event's clock), every photo of
   that Event is gone, from the bucket and from the database.

## Goals

1. **Anyone at the venue can upload, with no account.** The way in is a QR code: a link per Event that
   the organiser prints.
   - The public page shows photos but has **no** upload button. A random visitor can look but not add.
   - **[rev]** The QR link is a speed bump, not a secret: it hangs on a poster and may appear in a Live
     photo. The protections against abuse are the per-Event caps, Approve-first, the Off switch and
     link rotation.
2. **A photo always belongs to an Event.** Tagging it with a Tournament or Workshop of that Event is
   optional.
3. **The organiser picks the mode per Event:** **Off**, **Live instantly** or **Approve first**. Default
   **Off** (my call), so nothing changes for an existing Event until its organiser opts in.
4. **Moderators** are the Event's organisers (in the admin site) and staff logins with a new `photos` job
   (in the web-staff app). They approve photos in Approve-first mode, see reports, and delete any photo.
5. **Public "Photos" section** on the public Event page:
   - newest first;
   - refreshes by itself while the tab is visible;
   - filter by Tournament or Workshop;
   - under each photo: uploader name (optional), caption (optional), tag and time.
6. **Report button on every public photo.** A report reaches the moderators. The photo **stays
   visible** until a moderator deletes it.
7. **Upload window**, in the Event's own time zone: from the start of the day before the Event's first
   day to the end of the day after its last day. The day before lets the organiser test a printed QR
   code on set-up day. Earlier scans are refused. **[rev 441]** While photos are not Off, the hourly
   auto-archive waits until this window has closed. The organiser may still archive by hand at any
   time (442). **[rev 443]** The organiser may approve on an archived Event, as Delete allows; the
   `photos` staff login stops at archive (438).
   7b. **A notice above the Send button, with no checkbox.** In substance: "Share only photos you took. The
   people in them should be fine with it being shown publicly for 30 days." Nothing is recorded about
   it. The final EN and FR wording is the builder's draft, for the operator to read in review.
8. **All photos of an Event are deleted at the deletion instant** (see Storage and deletion), by MyClash
   jobs. **[rev]** The bucket's own expiry rule is the backstop.
9. **Storage is a new Scaleway S3 bucket, used for photos only.** It sits outside the nightly backup, so
   a deleted photo is really gone.
10. **Organisers can download all the photos** from the admin Photos page, as one zip, until the deletion
    instant.
    - Only organisers, not `photos` staff (my call).
    - The zip holds every stored original, live and waiting (my call). Deleted ones are gone. It can be
      filtered by Tournament or Workshop.
    - It includes a small CSV: file name · uploader name · caption · tag · time · status.
    - The button states the deletion date, and that downloaded copies are the organiser's to manage.
    - The API **streams** the zip from the bucket and never builds it in memory or on disk.
11. **Signed-in users can also upload from their personal space**, without the QR code.
    - **Only for their own Events**: the Events in their "My events" list (they fight, referee or teach
      there). For any other Event they scan the QR code like anyone else.
    - **The photo always carries their profile name.** There is no name box and no way to hide it.
    - **Same queue as everyone:** in Approve-first mode their photo waits too.
    - **Same mode, window and cap rules** as the QR path (my call). Mode Off or outside the window means
      no upload.
    - The Photos tab lists **their own photos** with status (waiting / live) and lets them **delete their
      own** (my call).
    - Their limit counts per account (the same 20 per hour) (my call).
    - Deleting the account deletes their photos (my call).
    - A QR upload by a signed-in person stays anonymous: the QR route's handler ignores the session
      **[rev]**. The guard still resolves it, as it does on every request.
    - **[rev 458-462, slice 6a]** The name is the fighter-profile name, else the name typed at
      sign-up, never the email (458); with neither, the upload is refused (`photo_no_name`). It is
      copied when the photo is sent, kept whole up to 200 characters (a typed QR name stays at 40).
      "Her own Events" is exactly the "my events" list (`listMyEvents`); its reads now fail loudly,
      so a database hiccup answers "photos are unavailable", never "not your event" (461). Her
      own photos are listed 30 at a time and deleted by her alone, after archive too. The account
      link refuses the account's delete instead of cascading (erasure deletes the photos first);
      anonymising her profile deletes them too (462). Two commits: 6a server, 6b the tab (459).

## Non-goals

- **No permanent archive.** Photos are not carried in the Event archive export. List the table in
  `ARCHIVE_EXCLUDED_TABLES` with a reason, like `event_feedback`.
- No likes, comments, albums, face tagging or video.
- No download-all for the public or for staff.
- No upload button on the public Event page itself. The two ways in are the QR link and the personal
  space (goal 11).
- No moving existing images (logos, fighter photos) to S3. They stay in Supabase Storage.

## Anti-goals — it fails even if it "works" if…

- a photo waiting for approval can be seen by the public, even by guessing its address;
- a photo reveals where it was taken, or anything else hidden in the file (GPS, EXIF, XMP, IPTC, data
  after the image itself);
- an image file survives past the deletion instant, in the bucket or in any backup, **on any deletion
  path** **[rev]**. Photo rows (name, caption, key) may live on in old database backups until those age
  out. The operator ruled this acceptable, since the image itself is gone;
- one phone uploading too much gets the whole hall's wifi blocked (all phones share one IP);
- **[rev]** a burst of uploads takes the API down for anyone else;
- the scoring app's offline behaviour changes (hard rule 3). web-staff **is** the scoring PWA
  (`apps/web-staff/public/sw.js`), and photos reach it only through a new, online-only screen;
- any user-facing string exists only in English (hard rule 6).

## Constraints from the codebase (verified 2026-11-03, re-verified 2026-11-04)

- **Images live in self-hosted Supabase Storage on a Docker volume, not S3.** Supabase Storage uses
  `STORAGE_BACKEND: file` on the `storage_data` volume (`infra/docker-compose.prod.yml:361-397`). The
  nightly backup tars that volume to Scaleway with aws-cli (`infra/scripts/backup.sh:104,151-159`). That
  is why photos get their own bucket.
- **No S3 client in the API.** `@aws-sdk/*` is new. A dependency added to `apps/api` lands in
  `apps/api/node_modules`, which the Dockerfile copies whole (`apps/api/Dockerfile:111`). **[rev]**
  `infra:review` does **not** gate npm dependencies (its rule covers workspace packages,
  `scripts/check-infra-review.mjs:3473-3517`). Build **and boot** the api image and hit the new route.
- **Every upload goes through `readUpload`** (`apps/api/src/common/read-upload.ts`). It holds the whole
  file in memory, about twice the limit per request (`:9-12`).
  - `read-upload.guard.test.ts` refuses any other file reader.
  - `upload-limits.routes.test.ts` is a hand-written list with a pinned count (`:162-164`), so bump it.
  - `upload-limits.refuse-first.test.ts` asserts `UnauthorizedException` only (`:38-42`). The anonymous
    route refuses on a bad token, mode Off, a closed window or a cap. It needs its own cell shape:
    "refused, and the file is never asked for".
- **[rev] The API is one container, `mem_limit: 1g`, `cpus: 2`** (`docker-compose.prod.yml:707-708`),
  serving every app. Photo uploads must stay inside a fixed memory budget (see The server).
- **[rev] Traefik v3.7.10 stops reading a request body after 60 s** (its default; the repo already
  designs around it at `apps/web-admin/app/admin/backups/chunked-upload.ts:4`). Operator ruling Q2:
  keep it. A cut upload shows the translated failure and the Retry button.
- **No server-side image library in the API.** sharp is already vetted for the workspace
  (`pnpm-workspace.yaml` `allowBuilds`, used by `apps/web-marketing`).
- **Scheduled work** uses BullMQ job schedulers upserted on boot
  (`apps/api/src/workers/data-retention.worker.ts:42-50`, test `data-retention.worker.test.ts`). Other
  jobs run at 03:30, 04:00 and 05:00, so pick a free slot. Nothing deletes stored objects today. **[rev]**
  The `worker` container boots the full app (`docker-compose.prod.yml:933`; `--worker` is not read), so
  jobs must be idempotent. They are.
- **Rate limiting:** `@nestjs/throttler`, in memory, one API container. The global limit is 120 per
  minute per IP, **per handler** (`common/throttling/throttler-options.ts:40-44`). Venue trap: every
  phone in the hall shares one IP (`throttle-profiles.ts:9-27`). `PUBLIC_LIVE_READ_THROTTLE` (600/min)
  exists for public polled reads.
- **[rev] Public route rules** (`apps/api/src/common/auth/public-routes.test.ts`):
  - `EXPECTED_PUBLIC` is an exact list (`:50-210`).
  - Public POST is allowed only for enumerated routes (`PUBLIC_POST_ALLOWLIST`, `:212-236`).
  - Public PUT, PATCH and DELETE are never allowed (`:317-322`).
  - Operator ruling Q1: add the upload and Report POSTs by name, and widen the docstring with the new
    class: "an anonymous contribution, locked by an Event secret and rate limits".
- **[rev] The public Event read returns every column of `events`.** `GET /events/:slug` is public and
  selects `*` (`events.service.ts:641-672`), and PostgREST exposes `events` to anon
  (`0002_rls.sql:212`). **No secret may live on `events`.**
- **Anonymous Event-scoped precedent:** `POST events/:eventId/guest-sessions`
  (`modules/auth/guest-sessions.controller.ts`). It is tied to a roster person, so it does not fit a
  spectator. Its cookie is a JWT signed with its own secret (`guest-jwt.service.ts:29`); photos follow
  that pattern. **[rev]** Do not use `COOKIE_SECRET`: it falls back to a dev string
  (`http-bootstrap.ts:10-12`).
- **Per-Event settings are typed columns on `events`** (`updateEventSchema`,
  `apps/api/src/modules/events/dto/events.dto.ts:68-94`). `PATCH /api/v1/events/:id` requires org
  `admin` (`events.service.ts:714-720`).
- **[rev] Staff jobs.** `STAFF_ROLES = ['scoring','checkin','gear']`
  (`packages/types/src/staff-role.ts:42`).
  - The DB refuses any other value: `CHECK (role IN (...))` (`0173_event_staff_account_role.sql:66-69`).
    A migration must re-add the CHECK with `photos`.
  - `landingPathForRole` is an if-chain ending in `return '/lices'` (`apps/web-staff/src/lib/landing.ts:20-25`),
    so the compiler does **not** catch a missing branch. Make it an exhaustive `switch` with a `never`
    check.
  - Compile breaks elsewhere (`Record<StaffRole,…>` in web-admin `staff/types.ts:49-65`) are still the
    checklist. Never add a `default:` branch.
- **Event clock.** `apps/api/src/common/event-clock.ts` (`eventZone`); day boundaries via
  `@myclash/time` `dayStartUtcIso` and `addDays`, as in `event-open-window.ts:28-39`.
  `start_date`/`end_date` are `DATE` (`0223`), and `timezone` is its own column.
- **Public Event page:** `apps/web-public/app/e/[eventSlug]/home/PublicHome.tsx`, with sibling routes.
  **[rev]** `useLiveBoard` polls without visibility gating. The visibility-gated poller to reuse is
  `watchSchedule` (`apps/web-public/src/components/me/watch-schedule.ts:21-57`).
- **No Content-Security-Policy anywhere** (`infra/config/traefik/middlewares.yml:5-12`). Signed bucket
  links need no CSP change. Use a plain `<img>`, as `EventHeader.tsx:1` does (no `remotePatterns`).
- **Edge firewall:** fail2ban sits on `/api/v1/staff-auth` and `/auth/v1` only, never on the API routers
  (`docker-compose.prod.yml:725,753,774-778`). Photo routes stay outside `/staff-auth`; no change needed.
- **[rev] Traefik `compress`** is on the admin API router (`docker-compose.prod.yml:729`,
  `middlewares.yml:3-4`). Exclude `application/zip` and `image/*` so a multi-GB zip is not compressed on
  a 0.5-CPU Traefik.
- **[rev] Zip writer:** `common/stored-zip.ts:14` is buffer-only and has no Zip64. The download needs a
  streaming Zip64 writer: a new dependency or a new writer, with the builder's choice reviewed.
- **[rev] Deletion paths that cascade to a photo row:**
  - Event delete (`events.service.ts:1388-1435`);
  - deletion-request approval (`admin/review-queue.service.ts:610-613`);
  - organisation deletes, cascading through `organization_id` (`0001_init.sql:164`);
  - account erasure, a hand-written list with no coverage test (`privacy/erasure.service.ts:65-112`).

  None of them reaches the bucket today.

- **Hard rules that bind:**
  - RLS on every new table (rule 4). New tables are closed to web writes since migration 0247, so writes
    go through the API.
  - EN and FR for every string (rule 6).
  - No real photos or personal data in the repo or fixtures (rule 7).
  - One concern per commit (rule 9).
- **Registries a new table must satisfy:**
  - archive coverage (`exports/archive.migration-coverage.test.ts`, triggered by `event_id`);
  - GDPR subject export (`privacy/subject-export.coverage.test.ts:61-62`, triggered by a `*_user_id`
    column);
  - **[rev]** erasure (manual, no gate: add the photo table to `deleteOwnedRows`);
  - **[rev]** the archived-Event lock ledger (`common/testing/archived-lock-ledger.ts:2-9`). The organiser's
    delete is allowed on an archived Event (`@AllowOnArchivedEvent`), for privacy. **[rev 443]** So is
    the organiser's approve, for a photo still waiting when the Event was archived. The `photos` staff
    login stops at archive (438).
- **Privacy policy.** Today it names Scaleway for encrypted backups only
  (`apps/web-marketing/src/pages/privacypolicy.astro:162`). **[rev]** Photos are new processing: public
  images of people, uploader names, the device cookie, 30-day retention and Scaleway as the host.
- **Latest migration is `0248`.** Number new ones max+1 when you commit.

## How it behaves — the decided parts

### The uploader (phone, no account)

1. They scan the QR code, which opens an upload page on web-public for that Event. **[rev]** The token is
   in the link's `#fragment`, so it never reaches the Traefik access log (`docker-compose.prod.yml:63`)
   or a Sentry URL.
2. If the mode is Off, the token is wrong, the window is closed or a cap is reached, the page says so
   plainly and offers the public Photos section instead.
3. They pick one or more photos and can add a name, a caption and a Tournament or Workshop (from that
   Event's public ones).
4. **The original photo is kept, up to 12 MiB per photo** (operator ruling; written `12 * MIB` in code).
   - The original is never shrunk.
   - The page shows progress per photo. A failed one can be retried, and so can one cut at 60 s.
   - A "busy, retrying" answer (see The server) is retried automatically after a short pause.
5. In Live mode the photo appears on the public feed at once. In Approve-first mode the page says it is
   waiting for approval.

### The server (my calls, within the constraints above)

- **[rev] The QR token is never stored where anyone can read it.**
  - `events` gets a `photo_token_version int` column.
  - The token is HMAC(`PHOTO_TOKEN_SECRET`, `event_id:version`), so the admin page can show it again for
    printing.
  - "New link" increments the version, and the old QR code stops working.
  - A test asserts that the public Event read carries no token.
- **Device cookie:** a JWT signed with its own required secret (`PHOTO_DEVICE_JWT_SECRET`), set the same
  way as `mc_guest` (same attributes, so it reaches the API from the web-public origin; a test pins
  them). It is a convenience limit (20 per hour per device), not a security boundary.
- **Refuses before reading the file** when the token, mode, window, device limit or a per-Event cap is
  wrong. The order is cheapest first, and the file is never asked for.
- **[rev] Per-Event caps (operator Q3):** 300 photos per hour and 15 GB stored per Event. Both are counted
  from the photo rows (each row stores the original's byte size). When a cap is reached, a translated
  refusal is shown, and the admin Photos page tells the organisers.
  - **The race:** two uploads read the count before either writes, so a cap can be overshot. The
    overshoot is bounded by the concurrency cap below (at most 4 photos). This is accepted and not
    locked.
- **[rev] Concurrency cap (assumed — protects the 1 GB API):**
  - At most **4 photo uploads** are processed at once. The counter is in memory, in one API container.
  - The fifth gets a translated 503 "busy, retrying" through `OperationalUnavailableException`
    (`common/operational-exception.ts:20`). The page retries it on its own.
  - The cap is taken **before** the file is read and released in `finally`.
  - Worst case is 4 × (24 MB read + strip copy + preview decode) ≈ 300 MB.
  - The `worker` container boots the same app (`docker-compose.prod.yml:933`) but serves no HTTP, so one
    counter holds. A comment at the cap says so; if the worker ever serves HTTP, the budget doubles.
- **Refuses any file over 12 MiB** with a clear "photo too large" message, through `readUpload`'s limit
  for this route (pinned in `upload-limits.routes.test.ts`).
- **Checks the bytes really are a JPEG or WebP** (magic bytes), not the declared type. iPhones may send
  HEIC, which most browsers cannot show. The builder decides whether the phone converts it before
  sending or the upload refuses it with a clear message. Never store a HEIC the feed cannot show.
- **[rev] Removes all hidden data server-side by whitelist, never by blacklist.**
  - Keep only the image data and a minimal Orientation tag, so the photo stays upright.
  - Drop every other segment or chunk: EXIF, XMP, IPTC/APP13, ICC is optional, and any bytes after the
    image's end marker (MPF secondary images, Motion Photo video).
  - The builder picks how: a pure-JS segment rebuild, or an image library. An image library needs
    `principal-engineer` sign-off.
- **A small preview per photo** (~1024 px, a few hundred KB) feeds the public list and the moderation
  queue. The original opens on tap.
  - The builder decides who makes it: the server (image library, same sign-off) or the phone. If the
    phone makes it, moderators must judge the original.
  - **[rev]** The photo row is written only after the original **and** the preview are both stored.
- Name and caption: short (my call: name ≤ 40 characters, caption ≤ 200), plain text, rendered as text.

### Moderation

- **Organisers** get a Photos page under the Event in the admin site, gated like
  `PATCH events/:id` (org `admin`). It holds:
  - the mode setting (Off / Live / Approve first);
  - the printable QR code (`qrcode.react` is already a dependency);
  - the cap status;
  - the queue: Waiting, Reported, All.
- **Staff logins with the `photos` job** land on `/photos` in web-staff, with the same queue.
  - The organiser creates them like any other staff login.
  - The screen is online-only. **[rev]** It is not added to `SHELL_URLS` in `sw.js`, and the offline
    E2E suite and `sw.test.ts` stay green.
- **Actions:** approve, delete, and **keep**, which clears a photo's reports (my call). Delete removes the
  row; the object goes through the tombstone queue (see Storage and deletion).
- Reports reach moderators only in the "Reported" tab. No email or push (my call).
- **[rev 452, 454-457, slice 4c]** Each reported photo shows its report count and its reports'
  comments, newest first, on every tab it appears in (456). The Reported tab lists by when the
  photo was sent, as Waiting and All (455). Keep acts without asking (454) and clears only the
  reports up to the newest the screen showed; a later one stays, and so does the photo in
  Reported (457). Known gap, accepted with the plan (its assumption 9): "later" is the report's
  first time. A phone that already reported and only changes its comment after the screen was
  read keeps that time, so Keep clears the changed comment unseen. Closing it needs a "comment
  changed at" column (a migration).
- **Mode changes** (my calls):
  - **Off** hides every photo from the public and stops uploads. It is the organiser's kill switch.
    Turning photos back on shows the approved ones again. **[rev]** Links already handed out stay valid
    until they expire, at most 15 minutes.
  - **Live → Approve first** leaves live photos live.
  - **Approve first → Live** leaves waiting photos in the queue. "Approved" is a stored state, not
    worked out from the mode.

### The public

- A "Photos" section/route on the public Event page:
  - newest first, with a Tournament / Workshop filter;
  - refreshes about every 30 s **while the tab is visible**, reusing `watchSchedule`. No realtime
    channel, so no anon read policy is needed.
  - **[rev]** The feed GET carries `PUBLIC_LIVE_READ_THROTTLE`.
- It shows only approved photos (in Live mode a photo counts as approved on arrival), of an Event the
  visitor may see, following `isPublicEvent` (`common/auth/event-read-gate.ts:31`).
  - **[rev]** A tag naming a Tournament or Workshop the visitor may not read is dropped from the
    response (`canReadTournament` / hidden ids).
- Each photo has a Report button. **[rev]** Reports are limited and de-duplicated per device and photo,
  never per IP. Reported photos stay visible.
- **[rev 445-448, slice 4a]** The list is `GET events/:eventId/photos/public`, 30 a page, empty while
  photos are Off and from the deletion instant on. A Report is one row per photo and phone
  (`event_photo_reports`, migration 0252), at most 30 photos per phone per hour and 20 reports per
  photo (449: past it a Report is answered and not stored); a photo the public cannot see answers
  "not found". It is taken on an archived Event too (447), whose photos stay
  public until the deletion date. Keep deletes the photo's reports, so a later report counts again
  (448). The page is a route `/e/<event>/photos` with a home card (446, slice 4b); the Reported
  tab is slice 4c (see "Moderation").
- **[rev 450-453, slice 4b]** The page reads the newest 30 every 30 s while visible and keeps what
  Load more added; a picture whose link has expired shows "Image unavailable" until a reload
  (450). The card stays after the deletion date; the page then says photos are deleted 30 days
  after the Event (451). Report asks first, with an optional comment of 200 characters at most,
  stored with the report (migration 0253) for the moderators (452); the phone's next comment
  replaces it, an empty Report leaves it (453).

### Storage and deletion

- **The bucket is private.** The public never gets a permanent object address. The API hands out signed
  links for approved photos only.
  - **[rev]** Links last 15 minutes, with the expiry rounded down to 5 minutes so browsers can cache
    them.
  - A waiting photo is unreachable. A deleted one answers 404 at once, because the object is gone.
- **[rev] One deletion mechanism for every path.**
  - A row-delete trigger on the photo table writes the object keys (original and preview) into a
    tombstone table. That table has RLS enabled and no anon or authenticated policy. The trigger
    function is `SECURITY INVOKER` with a pinned `search_path` (it runs as the deleting role, the API's
    service role; a `SECURITY DEFINER` function would be an RLS bypass to justify).
  - Cascades fire row triggers, so Event delete, org delete, deletion-request approval, account erasure,
    moderator delete and the expiry job all land there.
  - A worker job empties the tombstones: it deletes the object, then the tombstone. It retries and is
    safe to re-run.
- **Expiry job** **[rev slice 3]** **(every 5 minutes, not nightly):** for every Event past its deletion
  instant, it deletes its photo rows. The trigger queues their objects, and the drain in the same run
  deletes them. It logs what it deleted. A nightly run at one hour would reach an Event on another
  clock up to a day late (slice 3 plan, assumption 1).
- **[rev] Deletion instant, one owner:** 00:00 on `end_date + 31` days, on the Event's clock.
  - One helper serves the job, the admin "deletion date" label and the download button.
  - It follows the current `end_date`, so editing the dates moves it.
- **[rev slice 3] Orphan sweep:** hourly, delete any object at least an hour old, of an Event this
  database holds, that no photo row names (an upload whose row was never written). It does **not**
  delete the prefixes of Events it does not hold. Another stack given the same bucket keys would
  otherwise delete photos it knows nothing of, and the bucket has no backup. It first calls a function
  only the service role may run, so a wrong key fails instead of reading the photo table as empty.
  Event deletes queue their keys through the trigger; the lifecycle rule takes the rest (slice 3 plan,
  assumption 2).
- **[rev] Backstop:** a bucket lifecycle rule expires every object after 120 days (operator step).
- The bucket is not in the nightly backup, so deletion is final for the images.

## When the bucket is slow or down (my calls; the operator asked that nothing hangs)

No call to the bucket may wait forever. Set explicit S3 timeouts: connect 5 s, one object write 30 s,
list or delete 10 s, and abort a download stream that stalls for 30 s.

- **Upload.** On a timeout or bucket error, the API answers a 503 with a clear, translated "Photos are
  unavailable right now, try again", through the operational-exception marker. **No row is written
  unless both objects were stored.** The page keeps the photo and offers Retry.
- **Public feed and moderation queue.** The list is read from the database, so it still loads. Signed
  links are computed locally. An image that fails in the browser shows an "image unavailable" tile.
- **Tombstone drain.** Object first, tombstone second. A bucket failure stops the run and logs it, and
  the next run retries. A tombstone is never dropped while its object may exist.
- **Download all.** If the bucket fails mid-stream, the API aborts the connection, so the browser reports
  a failed download. A cut zip is invalid anyway, because its directory comes last.
- **Visibility.** One "photo storage" check on the runtime health dashboard: a new collector beside
  `collectDb`/`Redis`/`Queues`/`Disk` (`modules/admin/runtime-health.service.ts:53-57`), plus the card,
  the alert settings and i18n. It is its own slice.
- **Tests.** Each path runs with a bucket double that times out and one that errors.

## Download all — specifics [rev]

- A streaming Zip64 writer.
- Each original's CRC32 and size are stored at upload, so entry headers can be written without reading
  each object twice.
- CSV cells go through `escapeCsvCell` (`packages/types/src/csv.ts:97-103`), so names typed by anonymous
  users cannot inject formulas.
- Traefik `compress` excludes `application/zip`.

## Where it shows up (sketches the operator accepted; final look per DESIGN.md)

1. **Admin site, Event → new "Photos" page (organisers).**
   - The mode switch.
   - The QR code, with "Print poster" (reusing the A4 print shell in
     `apps/web-admin/app/org/[slug]/events/[eventId]/print/print-shell.ts`) and "New link".
   - The cap status.
   - "Download all", with the Tournament / Workshop filter and the deletion date.
   - Tabs Waiting / Reported / All. Each photo shows name · caption · tag · time, with Approve / Keep /
     Delete.
   - The nav entry is added in `event-nav-groups.ts`. The Event's staff page gets a fourth job,
     **Photos**.
2. **Upload page on web-public**, reached only from the QR link, made for phones: Event name; "Take or
   choose photos"; optional name, caption and Tournament/Workshop picker; the notice line; Send.
3. **Public Event page, new "Photos" section beside "Live now".** Tournament/Workshop filter; newest
   first; each photo with name · caption · tag · time and a Report button.
4. **web-staff, `photos` job.** Lands straight on the queue. No scoring screens.
5. **Personal space, per-Event hub** (`/me/events/[eventSlug]`), new "Photos" tab (widen
   `HubTab` in `apps/web-public/src/components/me/EventHubChrome.tsx:10`).
   - It holds the upload form (no name box, "Posted as «profile name»"), then "My photos" with each
     photo's status and a Delete button.
   - **[rev]** The tab shows when the mode is not Off **or** the user has photos there. The upload form
     shows only when the mode is not Off.
   - **[rev]** Membership is checked by one predicate, extracted from `MeEventsService.listMyEvents`
     (`me/me-events.service.ts:336-436`) and used by both the list and the upload check.

## What the operator must do (outside the code)

- Create the Scaleway bucket: private, **versioning off**, a lifecycle rule expiring every object after
  120 days, and CORS left closed. Create an API key scoped to it.
- Put the values in the prod `.env`.
- **[rev]** Read the updated privacy-policy text (builder's draft, EN and FR) before it ships.

## Left to the builder

- Table and column names, and route paths. The photo's Tournament / Workshop links are
  `ON DELETE SET NULL`, so deleting a Tournament never blocks on its photos (cascade probe,
  `ci.yml:588-595`).
- New env keys:
  - bucket name, endpoint, region and key pair;
  - `PHOTO_TOKEN_SECRET`;
  - `PHOTO_DEVICE_JWT_SECRET`.

  Each goes in `.env.example`, the compose passthrough for **both api and worker**
  (`docker-compose.prod.yml:663-666`) and `scripts/ensure-prod-env.mjs`.

- The S3 client library, and how the API image is updated to carry it. **[rev]** With AWS SDK v3, set
  the checksum options to `WHEN_REQUIRED` for an S3-compatible store (UNVERIFIED against Scaleway:
  settle it with one `PutObject` + `DeleteObjects` against a test bucket).
- The layout of the public Photos section, the staff `/photos` screen and the admin page, following
  `DESIGN.md`, `docs/design/` and `docs/design/known-deviations.md`.
- The slice split, one concern per commit. Suggested:
  1. bucket client + health check;
  2. table + token + upload;
  3. tombstones + expiry + orphan sweep;
  4. public feed;
  5. moderation (admin + staff role);
  6. personal space;
  7. download;
  8. privacy policy.

## Cost note (my estimate)

Originals average about 5-8 MB, so 1,000 photos are about 5-8 GB (plus small previews) for at most about
5 weeks. That is still under €1 per Event. The 15 GB cap bounds the worst case. Outbound traffic for
viewers is the larger line, and it is still small.

## Verification (for the build plan)

**API tests**

- Upload refused before read (the file is never asked for) on: a bad token, a rotated token, mode Off,
  window closed, device limit, each per-Event cap, and the concurrency cap (the 503 carries the marker).
- A 12 MiB + 1 byte file is refused and a 12 MiB file is accepted.
- The magic-byte check.
- A rotated synthetic photo stays upright after the strip.
- **[rev]** Metadata stripped, using synthetic fixtures only:
  - EXIF GPS;
  - XMP GPS;
  - APP13/IPTC;
  - bytes after the end marker;
  - WebP `EXIF` and `XMP ` chunks.
- **[rev]** The public Event read and the PostgREST `events` row carry no token.
- Waiting photos are absent from the public read.
- **[rev]** A hidden Tournament's tag is dropped from the public read.
- A report does not hide the photo, and a second report from the same device is not counted.
- Signed-in upload is refused for an Event outside the user's own Events (server-side; mind
  `user_id` ≠ person ≠ global_person).
- A signed-in photo shows the profile name and ignores any name sent.
- A user deletes their own photo but not another's.
- "Keep" clears reports.
- Mode Off hides all photos from the public read.
- Window: refused two days before the first day and the day after "the day after"; accepted on set-up
  day (Event's clock).

**Deletion tests**

- Each path queues tombstones for both objects: Event delete, org delete, deletion-request approval,
  account erasure and moderator delete. **[rev]** These are DB tests against the replayed schema, not
  mocks.
- The drain deletes the object first, and keeps the tombstone when the bucket fails.
- Expiry: an Event at its deletion instant minus 1 s keeps its photos; at the instant it loses them.
  Time-zone cells: UTC, Paris, New York, Kiritimati.
- Orphan sweep **[rev slice 3]**: an old object of an Event here with no photo row is removed; one with a
  row, a young one, and one of an Event not here are kept.

**Download test**

- An organiser gets a zip whose entries match the stored originals and the CSV rows.
- The CSV neutralises a `=HYPERLINK(...)` caption.
- A `photos` staff login and a stranger are refused.
- The stream starts before all objects are read, and memory stays flat: peak `heapUsed` stays under a
  fixed bound (e.g. 64 MB) while streaming a 1 GiB synthetic set.
- **[rev]** A synthetic set over 4 GiB produces a valid Zip64.

**Guard suites green**

- upload-limit guards (with the new cell shape);
- `public-routes.test.ts` (`EXPECTED_PUBLIC` + allowlist, with reasons);
- route-authz ledger;
- archived-lock ledger;
- archive coverage;
- subject-export coverage;
- i18n EN+FR sweep (run `packages/i18n` test directly, not through turbo);
- `landing.test.ts` / `screen-access.test.ts` with `photos`.

**Migration**

- Replay with `pnpm db:migrations:replay`.
- A `pg_policies` read shows RLS enabled with no anon/authenticated policy on the photo and tombstone
  tables.
- The staff CHECK accepts `photos`.

**Image boot:** build and boot the api image, then hit the upload route.

**Browser (CI, API stubbed):** the scan-link upload page on a phone viewport; the staff `/photos` queue.
The real upload → approve → feed path runs only in the prod suite (`tests/e2e`), against a real bucket
with cleanup.

**Before push:** the full `myclash-gates` chain; the offline E2E suite still passes.
