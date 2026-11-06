# Event photos — slice 8: the privacy policy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the operator builds native) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The privacy policy (FR and EN) says what MyClash does with Event photos, lists every cookie the apps set, stops quoting the data download's table and file counts, and the two photo forms link to it; the version is bumped so every account accepts the new text.

**Architecture:**

- The text lives on the marketing site: `apps/web-marketing/src/pages/privacypolicy.astro` (FR) and `apps/web-marketing/src/pages/en/privacypolicy.astro` (EN). A new section **3bis** (`<h2 id="photos">`) holds the photo story; short additions in §1.1, §2.4, §5, §6, §6.1, §7 and §11 point at it.
- The version is `LEGAL_POLICIES.privacy.version` in `packages/types/src/legal.ts`; `apps/web-marketing/test/privacy-date.test.mjs` already ties it to both pages' "Last updated" line. Bumping it asks every account to accept again (`pendingLegal` on `GET /api/v1/me`, `LegalUpdateBanner`).
- A new ROOT script test, `scripts/privacy-cookies.test.mjs` (run by `pnpm test:scripts`, outside turbo), holds the cookie list of both page sources against the code, both ways, and the `#photos` anchor. Not in `apps/web-marketing/test/`: turbo caches `web-marketing#test` on that package's own files (`turbo.json` declares no inputs; CI restores `.turbo`, `ci.yml:70-72`), so a cookie added in `apps/api` would be served a cached green.
- The repo's two other cookie lists, `docs/decisions/ADR-012-cookie-consent.md:24-31` ("Five cookies exist", listing six) and `docs/SECURITY_POSTURE.md:44-49` (four), gain `mc_photo_device` and lose their count.
- The two in-app "Your data" strings (`publicApp.security.dataSubtitle`, `.dataRetentionBody`, EN and FR) name the photos.
- web-public: the shared `PhotoForm` (QR page and personal-space Photos tab) gets a `PhotoNotice` with a link to `<policy>#photos`, opened in a new tab.

**Tech Stack:** Astro 7 (static pages), `node:test` over `dist/`, `@myclash/i18n`, Next 16 / React 19 (web-public), Playwright a11y specs.

**Spec:** `docs/superpowers/specs/2026-11-03-event-photos-design.md`: "Privacy policy" under the constraints (`:209-211`: public images of people, uploader names, the device cookie, 30-day retention, Scaleway), Goal 10 (`:58-65`, "downloaded copies are the organiser's to manage"), Goal 11 (`:66-86`, rulings 458-462), "What the operator must do" (`:446`: read the EN and FR draft before it ships), the `[rev slice 7a]` note (`:399-411`).

**Scripts** (copy into this session's scratchpad, read first): `…\f81e81f1-aa3e-48ee-aa5f-6a61116b3c0f\scratchpad\` — `gates.sh <ABSOLUTE outdir>`, `watch-ci.sh <full sha>`, `baseline-audit.mjs`; `…\fc383466-7375-4762-b52f-d9fbcb891db6\scratchpad\falsify-6b.mjs` (the web-public row model).

## In plain words

Léa scans the QR code at the Lyon Open. Under "Share only photos you took…" she now sees a link, "How MyClash handles photos". It opens the privacy policy in a new tab, at a new section about photos, and the photos she already picked stay where they are. The section tells her, in a few short blocks: what we keep (the photo, the name and caption she typed, a random number for her phone in a cookie; never her position, which we strip from the photo, nor her IP address); who sees it (everyone, at once or after an organiser approves it, as the organiser chose); that the organiser can download all the photos as one zip and that those copies are then the organiser's business; that a Report keeps her comment and her phone's number until a moderator decides; that everything goes 30 days after the Event's last day; and what she can do: delete a photo she sent from her personal space, or ask the organiser (or us) about one sent from the QR code, or one she appears in. The organiser of the Event is the one in charge of its photos, as for the roster (472).

The next time any signed-in person opens MyClash, the banner they saw on 29 October appears again: "our privacy policy has changed, please accept it" (473). The "Your data" box in settings now says the download holds the list of photos she sent, and that deleting the account deletes them.

Two old mistakes get fixed in the same new version (474). The cookie table said "four cookies": a staff tablet's sign-in cookie and its colour-theme cookie were missing, and photos add a third. It now lists all seven, and a test fails if the code sets a cookie the policy does not name, or the policy names one the code no longer sets. The policy also said the data download is "42 tables in twelve files"; it is 59 in 15 today, so the numbers go and the sentence says what the inventory is instead.

The cold review found two things the policy could not honestly say yet. First, when Léa is signed in and sends a photo by QR code, the photo has no name, but the API's log line for that request holds her account number and her IP address: anyone reading the logs could match them. That log line goes (476), so the promise "nothing links this photo to your account" becomes true. Second, signing in with Google leaves a full copy of the login in a cookie that page scripts can read; that is a security fix of its own, done first (477), and this slice waits for it.

A correction to my question about the link: every web-public page already has a "Privacy Policy" link in its footer, the send page included. The new link (475) sits next to the notice, where Léa reads before pressing Send, and goes straight to the photo section.

## Rulings for this slice (2026-11-06 ~16:00, this session; each the recommended answer)

- **472.** **The Event's organiser is in charge (the controller) of its photos**; MyClash hosts them for the organiser, as for the roster (§1.1). The organiser's downloaded copies are wholly the organiser's.
- **473.** **The privacy version is bumped**: photos are new processing, so every account is asked to accept the new text (the 2026-10-29 precedent).
- **474.** **The two old errors are fixed in the same version**: §9 lists every cookie (with a test both ways), §2 drops the "42 tables / twelve files" counts. Two commits (photos; the old errors), one version date.
- **475.** **A privacy-policy link under the photo notice**, on the QR page and the personal-space Photos tab (one shared form).
- **476** (~16:55, after the cold review). **A QR photo stays anonymous in the logs too**: the QR send and the Report stop writing the caller's account (`actorId`) and request headers into the API request log (`request-logging.middleware.ts:23-27,75-88`; `isSensitiveRoute` misses `/photos`, `redaction.ts:44-46`). Its own commit (Task 0).
- **477** (~16:55). **The Google sign-in's browser copy of the login is a security fix of its own, BEFORE this slice**: `createOAuthSupabaseClient` (`oauth-supabase.ts:30-36`, `persistSession: true`) leaves the session, refresh token included, in a script-readable `@supabase/ssr` cookie after the exchange (`auth/oauth/callback/page.tsx:114-120`). That slice deletes it and fixes §9's Google row and §10's "inaccessible to JavaScript"; this plan's commit 2 builds on it.

- **478** (~18:25). Google sign-in was never on in production: the 477 fix cleans up no old copies.
- **Texts approved** (~18:20) as drafted, before the 477 cookie row was added (that row is to be read).
- **479** (~21:30, after the cold code review). **A QR photo "is not stored with your account"**, not "nothing links it to you": Fastify's own request line and Traefik's access log keep the phone's address, and a signed-in page load keeps the same address beside the account. Three places, FR and EN; no code change.

The next free ruling number is **480**.

## Order

1. **The Google cookie fix (477)**: `docs/superpowers/plans/2026-11-06-oauth-login-leftover.md`, its own commit, code only. It leaves one Google cookie family, `mc-oauth-…-code-verifier` (1 hour, deleted once used); this plan's Task 2 writes its §9 row and its `LIBRARY_COOKIES` entry. This plan does not start before it is pushed.
2. **Task 0** — the log fix (476), commit 0.
3. **Tasks 1-3** — commits 1-3. Commits 0-3 go in ONE push (assumption 1).

## Assumptions (mine; the operator reads them before the build)

1. **The version is the day the slice is pushed**, written in `legal.ts` and both "Last updated" lines (today: 2026-11-06). All three commits go in ONE push: commit 2 changes the text under commit 1's version, which is only safe if no deploy sits between them.
2. **"The organiser" means the club that runs the Event** (its admins), as in §1.1 today; "moderators" are the club's admins and the volunteers given the Photos job.
3. **The data download keeps the list of her photos, not the images** (as built in 6a: `photos.csv`, rows only). §11's "a complete archive of everything we hold" gains one sentence saying so and pointing at the Photos tab. Putting the images in the download would be its own slice (open question A).
4. **Backups are not mentioned for photos beyond "the images are never in our backups"** (true: the bucket is outside the nightly backup). The photo rows (name, caption) are in the database, so they stay in the encrypted database backups until those age out (`BACKUP_RETENTION_DAYS`, 60 in `.env.example`). The policy is silent on backup retention everywhere today (§6.1 says "deletion is immediate"); open question B.
5. **No face recognition** is claimed, because none exists; the sentence answers the obvious "is a face biometric data?" worry next to §2.8.
6. **The QR sender cannot delete her own photo** (no route: `photos.controller.ts` deletes for moderators only); the text says to ask the organiser or us.
7. **The 30-day rule is stated in words**, not as the code's instant (00:00 on the 31st day after the last day, on the Event's clock): "30 days after its last day, at midnight, Event time".
8. **Cookie lifetimes** come from the code: `mc_staff` until 06:00 the day after the Event's last day (`EVENT_CLOSING_HOUR`, `event-open-window.ts:8`), or 12 hours for a login made after that (only a `photos` job can, `staff.service.ts:509-513,1670-1672`); `sb-access-token` 30 days (`auth.service.ts:114,2343-2347`; §9 said "Session"), `mc_theme` one year (`ThemeSwitcher.tsx:26`), `mc_photo_device` 30 days from the first photo or Report, not renewed (`photo-device.ts:16`, `photos.controller.ts:295-309`).
9. **The cookie test finds cookies by name**: literals in `'` or `"` quotes only (a backtick comment names `mc_persona`, a cookie nothing sets: `e/[eventSlug]/home/page.tsx:7`) matching `mc_…` and `sb-access-token` / `sb-refresh-token` in non-test source under `apps/*/src`, `apps/*/app` and `packages/*/src`. Today that finds exactly the seven names. **A cookie a LIBRARY names is invisible to it** (the cold review's `@supabase/ssr` find): the test holds a short `LIBRARY_COOKIES` list, each entry with the file that creates the client, and asserts that file still exists and still calls that library; fix 477 fills it.
10. **The QR log fix (476)** covers `POST /api/v1/events/:eventId/photos` and `POST …/photos/:photoId/report` only, matched on method and on the path without its query: no actor, no headers. Every other photo route keeps its log (the organiser's routes are signed-in work; the public feed read is a page view). Traefik's access log still records every request's IP; §2.7 already discloses server logs, and the new §3bis says sending "leaves a line in our server logs".
11. **The export README (inside the zip, English only) is not changed**; it does not list photos. Named, not fixed.
12. **`mc_photo_device` needs no consent** (ADR-012's rule, ePrivacy Art. 5(3)): it exists only to limit abuse of a sending the person asked for by pressing Send or Report, carries a random number and nothing else, and is set only on those two requests (`photos.controller.ts:295-309`). This is a legal reading, the operator's to confirm; ADR-012 gets a `[rev slice 8]` fact line saying so.
13. **"Write to us" about a QR photo means a hand deletion in the database**: no delete route serves a platform admin (`photo-organiser.ts:22-31`; a super admin is not a club member). Accepted; a tool would be its own slice.
14. **The link label is "How MyClash handles photos" / "Comment MyClash traite les photos"**, and it opens in a new tab (`target="_blank" rel="noreferrer"`, as `LegalConsent.tsx:27-29`), so the picked photos are not lost.

## Open questions (not blocking this slice; the drafts below take the stated side)

- **A.** Should the data download carry the photo images themselves, not only the list? (Draft: no, and §11 says so.)
- **B.** Should the policy state how long encrypted database backups are kept (for photos and for everything else)? (Draft: no change.)
- **C.** The terms (§6) grant LYON AMHE a licence to use content "for the operation **and promotion** of the platform". A sent photo is content. Is that what you want for photos? A terms change is its own slice and its own re-acceptance.
- **D.** Minors appear in HEMA Event photos. Should §3bis say anything about them (for example: a parent may ask the organiser or us to remove a photo of their child)? (Draft: nothing beyond "you appear in a photo".)
- **E.** How long are the API's logs kept? Docker caps them by size (`max-size 10m × 3`, `infra/docker-compose.prod.yml:94`), not by days, so §2.7 cannot state a duration. (Draft: no change.)
- **F.** The cold reviewer's reading of 472: MyClash sets the phone cookie and fixes the 30 days and the stripping, which reads closer to joint control than to a pure processor. Ruled 472 stands unless you reopen it.

## Global Constraints

- Hard rule 6: every user-facing string in EN and FR (the policy pages are already hand-written per language; the in-app strings go through `@myclash/i18n`).
- Hard rule 7: no real names in the texts or tests ("Léa" stays out of the policy; the policy speaks to "you").
- Hard rule 9: one concern per commit — three commits, below.
- The privacy version, the FR "Dernière mise à jour : 6 novembre 2026" and the EN "Last updated: 6 November 2026" lines agree (`privacy-date.test.mjs`).
- Every function under 50 lines, every file under 400 (`quality:complexity`); `PhotoForm` is 48 lines today (`PhotoForm.tsx:160-207`).
- `pnpm format:check` covers this plan: Prettier it before the gates.

## Review Focus

1. **A link that opens in the same tab throws away the photos Léa picked** → the spec asserts `target="_blank"` (Task 3).
2. **The FR and EN pages drift** (one gets a cookie, the other not; one has the anchor, the other not) → the cookie and anchor tests read both built pages (Task 2).
3. **A cookie added later and never written in the policy** → the cookie test fails on an unlisted name; a removed one fails the other way (Task 2).
4. **The version bumped but a date line not changed, or the reverse** → `privacy-date.test.mjs` (Task 1, existing).
5. **The link points at a section that does not exist** (anchor renamed) → the anchor test (Task 2) and the spec's `href` (Task 3) pin the same `photos` id.
6. **A signed-in phone's QR photo traced back to her account through the log** → Task 0's tests, with her own signed-in send as the control that must still log.

---

### Task 0: A QR photo leaves no account in the request log (commit 0, ruling 476)

**Files:**

- Modify: `apps/api/src/common/observability/redaction.ts` — `export function isAnonymousPhotoRoute(method: string, path: string): boolean` (beside `isSensitiveRoute`).
- Modify: `apps/api/src/common/observability/request-logging.middleware.ts` — when it is true, omit `actorId` and `headers`.
- Test: `apps/api/src/common/observability/request-logging.middleware.test.ts`.

- [ ] **Step 1: Write the failing tests**, with an identity `{ kind: 'claimed', userId }` and an `x-forwarded-for` header on the request: `test('a QR photo send logs no account and no headers')` — `POST /api/v1/events/<uuid>/photos` → the sink's event has no `actorId` and no `headers`; the same for `POST /api/v1/events/<uuid>/photos/<uuid>/report`, and for each with a `?x=1` query. Controls that must keep both: `POST /api/v1/me/events/<uuid>/photos` (her signed-in send, `actorId: 'claimed:…'`), `GET /api/v1/events/<uuid>/photos/public`, `DELETE /api/v1/events/<uuid>/photos/<uuid>` (a moderator's).
- [ ] **Step 2:** Run `pnpm --filter @myclash/api exec vitest run request-logging` → the two QR cases FAIL.
- [ ] **Step 3:** Implement: method `POST`, path without query matching `/events/<segment>/photos` or `/events/<segment>/photos/<segment>/report` at the end. A regex literal with `\/` goes through the Write/Edit tool (CLAUDE.md).
- [ ] **Step 4:** Run → PASS. Falsify: drop the method check, drop the query strip, drop the `report` branch → each RED.
- [ ] **Step 5:** Commit `fix(photos): a photo sent from the qr code leaves no account in the request log`.

### Task 1: The policy names Event photos (commit 1)

**Files:**

- Modify: `apps/web-marketing/src/pages/privacypolicy.astro` (FR): `updated`, §1.1 table, §2.4, new §3bis after §3, §4 table, §5 table, §6 table, §6.1, §7 Scaleway row, §11 access row.
- Modify: `apps/web-marketing/src/pages/en/privacypolicy.astro` (EN): the same places.
- Modify: `packages/types/src/legal.ts` — `privacy.version` and a dated comment on top of the others.
- Modify: `packages/i18n/src/messages/en/publicApp.ts` and `fr/publicApp.ts` — `security.dataSubtitle`, `security.dataRetentionBody`.

**Interfaces:** Produces the anchor `id="photos"` on the §3bis `<h2>` of both pages (Tasks 2 and 3 rely on it).

- [ ] **Step 1:** Write the texts exactly as in "Draft texts" below (as the operator amended them), in both pages.
- [ ] **Step 2:** Set `privacy.version` to the push date; add the comment (no word "any": `quality:shared-types` flags it in a comment): "YYYY-MM-DD: §3bis on Event photos (new processing: images of people, the sender's name, the phone's cookie, the 30-day deletion, the organiser's zip); §1.1, §2.4, §5, §6, §6.1, §7 and §11 point at it. Bumped: this EXPANDS processing (rulings 472-473)."
- [ ] **Step 3:** `pnpm --filter @myclash/types build && pnpm --filter @myclash/web-marketing test` → `privacy-date` PASS, `site.test.mjs` PASS.
- [ ] **Step 4:** Change one date line only → `privacy-date` FAILS; restore.
- [ ] **Step 5:** `pnpm --filter @myclash/i18n build && pnpm --filter @myclash/i18n test` → PASS (EN/FR key parity).
- [ ] **Step 6:** Commit `docs(legal): the privacy policy says what happens to event photos` (stage the five files).

### Task 2: Every cookie, and no counts (commit 2)

**Files:**

- Create: `scripts/privacy-cookies.test.mjs` (picked up by `test:scripts`' `scripts/*.test.mjs` glob, `package.json:24`)
- Modify: both privacy pages — §2 intro sentence, §9 intro, table and the "This is why" paragraph.
- Modify: `docs/decisions/ADR-012-cookie-consent.md:24-31` — "Cookies exist, all first-party" (no count), add `mc_photo_device` with assumption 12's reasoning as `[rev slice 8]`; `docs/SECURITY_POSTURE.md:44-49` — a `mc_photo_device` row ("Event photo sender id JWT", same flags: `buildSessionCookieOptions`).
- Modify: `packages/types/src/legal.ts` — one line added to the Task 1 comment: "§9 now lists every cookie (`mc_staff` and `mc_theme` were missing since 2026-08-04) and §2 no longer counts the export's tables and files, which had drifted (ruling 474)." No second bump.

**Interfaces:** Consumes Task 1's `id="photos"`.

- [ ] **Step 1: Write the failing test** `scripts/privacy-cookies.test.mjs` (node:test, reads SOURCE, no build):
  - `test('the policy names every cookie the code sets, in both languages')`: walk `apps/*/{src,app}` and `packages/*/src`, files `.ts .tsx .js .mjs .cjs` only (skip `apps/web-marketing`, so the policy can never vouch for itself, and `node_modules`, `dist`, `.next`, files matching `.test.` / `.spec.`), collect literals in `'` or `"` quotes (never backticks: assumption 9) matching `mc_[a-z_]+` and `sb-(access|refresh)-token`; in `apps/web-marketing/src/pages/privacypolicy.astro` and `.../en/privacypolicy.astro`, take the text between `<!-- 9 -->` and `<!-- 10 -->`, then its first `<table>…</table>`, then each row's FIRST cell `<td><code>NAME</code></td>` (the paragraphs and §3bis also hold `<code>` names: they must not count); add the names of `LIBRARY_COOKIES` (fix 477's entries; for each, assert its `source` file exists and contains its `library` import, so a removed client fails the test); `assert.deepEqual(sorted(tableNames), sorted(codeNames))` per page, so a missing one AND a stale one both fail; `assert.ok(codeNames.length >= 7)` so an empty walk cannot pass. The comment says the walk finds cookies by these two name shapes only.
  - `test('both pages carry the photos section the photo forms link to')`: each source contains `<h2 id="photos">` exactly once.
- [ ] **Step 2:** `node --import tsx --test scripts/privacy-cookies.test.mjs` → the cookie test FAILS naming `mc_photo_device`, `mc_staff`, `mc_theme` (the anchor test passes after Task 1).
- [ ] **Step 3:** Rewrite §9 and the §2 intro as in "Draft texts"; edit ADR-012 and SECURITY_POSTURE.
- [ ] **Step 4:** Run again → PASS. Falsify (each proven to have changed the file): remove the `mc_theme` row from the EN page → FAIL; add a `mc_fake` row to the FR page → FAIL; rename `PHOTO_DEVICE_COOKIE`'s value in `photo-device.ts` → FAIL; restore. Then `pnpm --filter @myclash/web-marketing test` (build + `privacy-date` + `site`) → PASS.
- [ ] **Step 5:** Commit `fix(legal): the privacy policy lists every cookie and no longer counts the export's files`.

### Task 3: The link under the photo notice (commit 3)

**Files:**

- Modify: `apps/web-public/app/e/[eventSlug]/photos/_components/PhotoForm.tsx` — new `function PhotoNotice()` replacing the notice `<p>` (`:194-196`).
- Modify: `packages/i18n/src/messages/{en,fr}/publicApp.ts` — `photoSend.privacyLink`: EN "How MyClash handles photos", FR "Comment MyClash traite les photos".
- Test: `tests/a11y/photo-send.spec.ts`, `tests/a11y/me-photos.spec.ts`.

**Interfaces:** Consumes `getLegalUrl(kind, locale)` (`apps/web-public/src/lib/legal-url.ts`), `useI18n().locale`.

- [ ] **Step 1: Write the failing tests.** In `photo-send.spec.ts`, `test('the notice links to the photo section of the privacy policy, in a new tab')`: on the open form, `const link = page.getByRole('link', { name: 'How MyClash handles photos' })`; `toHaveAttribute('href', /\/en\/privacypolicy#photos$/)`; `toHaveAttribute('target', '_blank')`. In `me-photos.spec.ts`, the same two assertions on the tab's form (`openTab` with a live Event).
- [ ] **Step 2:** `pnpm --filter @myclash/i18n build` (apps read `dist`), then run both specs (stub + `next dev apps/web-public --port 3001` with the env of prompt §7) → FAIL (no such link).
- [ ] **Step 3:** `PhotoNotice` renders the existing dashed box with the notice text, then an `<a href={`${getLegalUrl('privacy', locale)}#photos`} target="_blank" rel="noreferrer">` with the token link classes used by `LegalConsent.tsx`. `PhotoForm` calls `<PhotoNotice />`.
- [ ] **Step 4:** Run → PASS. Count `PhotoForm` and `PhotoNotice` lines (< 50 each).
- [ ] **Step 5:** Falsify: drop `target`, drop `#photos`, rename the key in EN → each RED (run the i18n package's own check for the key row).
- [ ] **Step 6:** Commit `feat(photos): the photo notice links to the privacy policy's photo section`.

### Task 4: Proof, review, push

- [ ] `pnpm exec prettier --write` on every changed `.md`, `.astro`, `.ts`, `.mjs` (the plan, ADR-012 and SECURITY_POSTURE are under `format:check`).
- [ ] `gates.sh <absolute outdir>` → 33/33 green (no `next dev` running).
- [ ] Cold code review (opus) over the three commits; fix test-first.
- [ ] `git fetch`, `git log --oneline -1`, stage by explicit list, ONE push of the three commits; `watch-ci.sh <full sha>`.
- [ ] "As built" here; memory note; handoff.

---

## Draft texts (EN and FR) — for the operator to read and amend before the build

Each block replaces or is added at the named place. `<strong>` marks follow the page's own style.

### §1.1 — a third row in the table

**FR**

> **Vous avez envoyé une photo à un événement**, par le QR code ou depuis votre espace personnel, **ou vous figurez sur l'une d'elles** — **L'organisateur de cet événement.** C'est lui qui ouvre l'événement aux photos, les valide et peut les télécharger. MyClash les héberge pour lui et les supprime 30 jours après l'événement (voir §3bis)

**EN**

> **You sent a photo to an event**, from the QR code or from your personal space, **or you appear in one** — **The organiser of that event.** They open the event to photos, approve them and may download them. MyClash hosts them on their behalf and deletes them 30 days after the event (see §3bis)

### §2 — the opening sentence (commit 2)

**FR**

> La liste ci-dessous n'est pas un résumé écrit de mémoire : elle reprend l'inventaire technique que la plateforme utilise pour construire votre export de données — chaque table de la base qui peut vous concerner, et le fichier de l'archive où elle se trouve. Tout ce que nous détenons sur vous figure dans l'une de ces catégories.

**EN**

> The list below is not a summary written from memory: it mirrors the technical inventory the platform uses to build your data export — every database table that can concern you, and the file of the archive it goes into. Anything we hold about you appears in one of these categories.

### §2.4 — end of the paragraph

**FR** … et vos réglages de confidentialité**, ainsi que les photos que vous avez envoyées depuis votre espace personnel (voir §3bis)**.

**EN** … and your privacy settings**, and the photos you sent from your personal space (see §3bis)**.

### §3bis — new section, after §3 (`<h2 id="photos">`)

**FR**

> ## 3bis. Les photos d'un événement
>
> Un organisateur peut ouvrir son événement aux photos : les personnes présentes en envoient depuis leur téléphone, et la page publique de l'événement les montre. La fonction est désactivée par défaut ; elle n'existe sur un événement que si son organisateur l'a activée.
>
> ### Ce que nous enregistrons
>
> | Photo envoyée…                              | Ce que nous enregistrons                                                                                                                                                                                                                                                                                                    |
> | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | **par le QR code**, sans compte             | La photo ; un nom et une légende, si vous en saisissez (facultatifs) ; le tournoi ou l'atelier choisi ; l'heure d'envoi ; un numéro aléatoire propre à votre téléphone, enregistré avec la photo et gardé dans le cookie `mc_photo_device` (voir §9). Rien ne relie cette photo à votre compte, même si vous êtes connecté. |
> | **depuis votre espace personnel**, connecté | La photo, votre légende, le tournoi ou l'atelier choisi, l'heure, et **votre nom** — celui de votre profil, à défaut celui saisi à votre inscription —, affiché sous la photo. L'espace personnel ne permet pas d'envoi anonyme : pour cela, utilisez le QR code.                                                           |
>
> Avant d'enregistrer une photo, nous en retirons tout ce que le téléphone y cache : **la position GPS**, le modèle de l'appareil, la date de prise de vue, les miniatures. Seule l'orientation est gardée, pour que la photo reste droite. L'image elle-même n'est pas retouchée ; nous en gardons aussi une copie réduite pour l'affichage. Aucune reconnaissance faciale n'est appliquée. La photo ne porte pas votre adresse IP ; comme toute visite, l'envoi laisse une ligne dans les journaux de nos serveurs (voir §2.7).
>
> ### Qui les voit
>
> - Selon le choix de l'organisateur, une photo est **publique** sur la page de l'événement dès son envoi, ou seulement **après sa validation**. Une photo en attente n'est visible que des modérateurs, et de son auteur dans son espace personnel s'il l'a envoyée de là.
> - Les **modérateurs** sont les administrateurs du club organisateur et les bénévoles à qui il confie les photos. Ils voient toutes les photos de l'événement et leurs signalements, et peuvent supprimer n'importe laquelle.
> - L'organisateur peut **télécharger les photos de son événement** en une seule archive zip — les photos publiées comme celles en attente —, avec la liste des noms, légendes, tournois ou ateliers, heures et statuts, jusqu'à leur suppression. **Les copies téléchargées sont alors sous sa seule responsabilité** : la suppression automatique ci-dessous ne les atteint pas.
>
> ### Signaler une photo
>
> Sous chaque photo publique, « Signaler » la place dans la liste des photos signalées que voient les modérateurs. Nous enregistrons le commentaire que vous ajoutez (facultatif, 200 caractères au plus) et le numéro aléatoire de votre téléphone (le même cookie). La photo reste visible jusqu'à ce qu'un modérateur la supprime ou décide de la garder ; s'il la garde, les signalements qu'il a lus sont effacés.
>
> ### Combien de temps
>
> **Toutes les photos d'un événement sont supprimées 30 jours après son dernier jour**, à minuit, heure de l'événement, avec leurs noms, légendes et signalements. Une photo part plus tôt si un modérateur la supprime ou si l'événement est supprimé ; et, pour une photo envoyée depuis votre espace personnel, si vous la supprimez, si vous supprimez votre compte ou si vous nous demandez d'anonymiser votre nom. Les images ne figurent jamais dans nos sauvegardes.
>
> ### Ce que vous pouvez faire
>
> - **Vous avez envoyé une photo depuis votre espace personnel** : l'onglet Photos de l'événement, dans votre espace, la liste, et vous pouvez la supprimer à tout moment. Si l'événement n'apparaît plus dans votre espace, écrivez-nous.
> - **Vous avez envoyé une photo par le QR code** : rien ne la relie à vous, vous ne pouvez donc pas la supprimer vous-même. Demandez-le à l'organisateur, ou écrivez-nous.
> - **Vous figurez sur une photo** que vous ne voulez pas voir publiée : appuyez sur « Signaler » et dites-le, ou écrivez à l'organisateur. Si vous ne parvenez pas à le joindre, écrivez-nous (voir §11) : nous vous aiderons.

**EN**

> ## 3bis. An event's photos
>
> An organiser may open their event to photos: people at the venue send them from their phone, and the event's public page shows them. The feature is off by default; it exists on an event only if its organiser turned it on.
>
> ### What we record
>
> | Photo sent…                             | What we record                                                                                                                                                                                                                                                                                          |
> | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | **from the QR code**, with no account   | The photo; a name and a caption, if you type them (optional); the tournament or workshop you chose; the time it was sent; a random number for your phone, stored with the photo and kept in the `mc_photo_device` cookie (see §9). Nothing links this photo to your account, even if you are signed in. |
> | **from your personal space**, signed in | The photo, your caption, the tournament or workshop you chose, the time, and **your name** — your profile's, or else the one you typed when you signed up —, shown under the photo. The personal space has no anonymous sending: use the QR code for that.                                              |
>
> Before we store a photo, we remove everything the phone hides in it: **the GPS position**, the device model, the date it was taken, thumbnails. Only the orientation is kept, so the photo stays upright. The picture itself is not retouched; we also keep a smaller copy for display. No face recognition is applied. The photo does not carry your IP address; like every visit, sending it leaves a line in our server logs (see §2.7).
>
> ### Who sees them
>
> - Depending on the organiser's choice, a photo is **public** on the event's page as soon as it is sent, or only **once it is approved**. A photo waiting for approval is visible to the moderators only, and to its sender in their personal space if they sent it from there.
> - The **moderators** are the organising club's administrators and the volunteers it gives the photos to. They see every photo of the event and its reports, and may delete any of them.
> - The organiser may **download the event's photos** as one zip archive — published ones and those still waiting —, with the list of names, captions, tournaments or workshops, times and statuses, until they are deleted. **The downloaded copies are then the organiser's sole responsibility**: the automatic deletion below does not reach them.
>
> ### Reporting a photo
>
> Under every public photo, "Report" puts it in the list of reported photos the moderators see. We record the comment you add (optional, at most 200 characters) and your phone's random number (the same cookie). The photo stays visible until a moderator deletes it or decides to keep it; if they keep it, the reports they read are erased.
>
> ### How long
>
> **Every photo of an event is deleted 30 days after the event's last day**, at midnight, event time, with its name, caption and reports. A photo goes earlier if a moderator deletes it or the event is deleted; and, for a photo sent from your personal space, if you delete it, delete your account, or ask us to anonymise your name. The images are never in our backups.
>
> ### What you can do
>
> - **You sent a photo from your personal space**: the event's Photos tab, in your personal space, lists it, and you can delete it at any time. If the event no longer shows in your personal space, write to us.
> - **You sent a photo from the QR code**: nothing links it to you, so you cannot delete it yourself. Ask the organiser, or write to us.
> - **You appear in a photo** you do not want shown: press "Report" and say so, or write to the organiser. If you cannot reach them, write to us (see §11): we will help.

### §5 — two rows in the table, after "Profile photo"

**FR**

> Photos d'un événement, avec le nom et la légende saisis — Publiques sur la page de l'événement quand l'organisateur a ouvert les photos ; une photo en attente de validation n'est visible que des modérateurs et de son auteur (voir §3bis)
>
> Signalements d'une photo et leurs commentaires — Visibles uniquement des modérateurs

**EN**

> Event photos, with the name and caption typed — Public on the event's page when the organiser has opened it to photos; a photo waiting for approval is visible to the moderators and its sender only (see §3bis)
>
> Reports of a photo and their comments — Visible to the moderators only

### §6 — one row in the table, after "Guest sessions"

**FR** Photos d'un événement, leurs noms, légendes et signalements — **30 jours** après le dernier jour de l'événement, puis suppression automatique

**EN** Event photos, their names, captions and reports — **30 days** after the event's last day, then automatic deletion

### §6.1 — one bullet, and the anonymisation sentence

**FR** (après « vos sessions invité, … ») « les photos que vous avez envoyées depuis votre espace personnel sont supprimées ; » — et la phrase finale du paragraphe « Vos résultats… » devient : « …demandez-le-nous : nous l'anonymisons, le résultat subsiste sous une entrée anonyme, et les photos que vous avez envoyées depuis votre espace personnel sont supprimées. »

**EN** (after "your guest sessions, …") "the photos you sent from your personal space are deleted;" — and the last sentence of "Your competition results…" becomes: "…ask us: we anonymise it, the result survives under an anonymous entry, and the photos you sent from your personal space are deleted."

### §7 — the Scaleway row

**FR** Stockage hors-site des sauvegardes chiffrées. Stockage des photos d'événement, dans un espace séparé tenu hors des sauvegardes ; votre navigateur charge les images directement depuis cet espace, Scaleway reçoit donc votre adresse IP quand vous les regardez — 🇪🇺 France

**EN** Off-site storage of encrypted backups. Storage of event photos, in a separate space kept out of the backups; your browser loads the images straight from that space, so Scaleway receives your IP address when you view them — 🇪🇺 France

### §4 — two rows in the legal-basis table, after "Publish results"

**FR**

> Montrer les photos d'un événement envoyées par les personnes présentes, permettre à l'organisateur de les modérer et de les télécharger — Intérêt légitime de l'organisateur à partager son événement ; l'envoi est volontaire, et toute photo publique peut être signalée
>
> Limiter les abus de l'envoi de photos et des signalements (cookie `mc_photo_device`) — Intérêt légitime

**EN**

> Showing an event's photos sent by people at the venue, letting the organiser moderate and download them — The organiser's legitimate interest in sharing their event; sending is voluntary, and every public photo can be reported
>
> Limiting abuse of photo sending and reports (the `mc_photo_device` cookie) — Legitimate interest

### §9 — the cookie table and its two paragraphs (commit 2)

**FR** — intro: « MyClash ne dépose **que ses propres cookies**, tous listés ci-dessous. Aucun ne sert à la publicité, à la mesure d'audience ou au pistage. » Lignes ajoutées :

> `mc_staff` — Connecte une tablette ou un téléphone du personnel (arbitrage, accueil, matériel, photos) à un événement, après la saisie de son code — Jusqu'à 6 h le lendemain du dernier jour de l'événement ; 12 heures pour une connexion ouverte après cette heure (la modération des photos)
>
> Ligne existante corrigée : `sb-access-token` — Vous maintient connecté — **30 jours**, renouvelé tant que vous restez actif
>
> `mc-oauth-…-code-verifier` — Pendant une connexion avec Google, relie le retour de Google au navigateur qui l'a commencée ; supprimé dès qu'il a servi — 1 heure (ajouté après la relecture du 6 novembre : texte de la correction 477, à relire)
>
> `mc_theme` — Retient le thème de couleurs choisi sur une tablette d'arbitrage — 1 an
>
> `mc_photo_device` — Un numéro aléatoire qui compte les photos et les signalements envoyés depuis un même téléphone, pour qu'un seul appareil ne puisse pas submerger un événement. Il ne dit pas qui vous êtes — 30 jours

Le paragraphe « C'est pourquoi… » : « …MyClash n'en dépose aucun. `sb-access-token`, `sb-refresh-token`, `mc-oauth-…-code-verifier`, `mc_guest` et `mc_staff` sont strictement nécessaires à un service que vous avez demandé en vous connectant ; `mc_photo_device` protège l'envoi de photos que vous utilisez ; `mc_locale` et `mc_theme` enregistrent un choix que vous avez fait vous-même. Afficher une fenêtre de consentement… »

**EN** — intro: "MyClash sets **only its own cookies**, all listed below. None is used for advertising, audience measurement or tracking." Rows added:

> `mc_staff` — Signs a staff tablet or phone (scoring, check-in desk, gear, photos) in to one event, once its code is entered — Until 6 am the day after the event's last day; 12 hours for a sign-in made after that time (photo moderation)
>
> Existing row corrected: `sb-access-token` — Keeps you signed in — **30 days**, renewed while you stay active
>
> `mc-oauth-…-code-verifier` — During a Google sign-in, links the return from Google to the browser that started it; deleted once used — 1 hour (added after the 6 November approval: fix 477's text, to be read)
>
> `mc_theme` — Remembers the colour theme chosen on a scoring tablet — 1 year
>
> `mc_photo_device` — A random number that counts the photos and reports sent from one phone, so a single device cannot flood an event. It does not say who you are — 30 days

The "This is why" paragraph: "…MyClash sets none. `sb-access-token`, `sb-refresh-token`, `mc-oauth-…-code-verifier`, `mc_guest` and `mc_staff` are strictly necessary for a service you asked for by signing in; `mc_photo_device` protects the photo sending you are using; `mc_locale` and `mc_theme` record a choice you made yourself. Displaying a consent dialog…"

### §11 — the access row

**FR** … dans un format lisible par machine. **Les photos que vous avez envoyées depuis votre espace personnel y figurent sous forme de liste (`photos.csv`) ; les images elles-mêmes se voient dans l'onglet Photos de l'événement. Une photo envoyée par le QR code n'y est pas : rien ne la relie à vous.**

**EN** … in a machine-readable format. **The photos you sent from your personal space appear in it as a list (`photos.csv`); the images themselves are in the event's Photos tab. A photo sent from the QR code is not in it: nothing links it to you.**

### In-app — Settings → "Your data"

**`dataSubtitle`** EN: "Download everything MyClash holds about you — your profile, events, matches, refereeing, workshops, the list of photos you sent from your personal space and your preferences — as a zip of readable files." FR : « Téléchargez tout ce que MyClash conserve à votre sujet — profil, événements, matchs, arbitrage, stages, la liste des photos envoyées depuis votre espace personnel et préférences — sous forme d'une archive de fichiers lisibles. »

**`dataRetentionBody`** EN: "Your sign-in and personal details — photo, biography, date of birth, contact email and social links — are deleted, along with the photos you sent from your personal space, your follows and notification settings. …" (rest unchanged). FR : « Votre connexion et vos informations personnelles — photo, biographie, date de naissance, email de contact et liens sociaux — sont supprimées, ainsi que les photos que vous avez envoyées depuis votre espace personnel, vos abonnements et vos préférences de notification. … » (suite inchangée).

### In-app — the photo notice link (commit 3)

EN "How MyClash handles photos" · FR « Comment MyClash traite les photos »

## Reviews (2026-11-06, this session)

- **myclash-plan-review, pass 1**: MAJOR verification — the cookie test under `apps/web-marketing/test/` is cached by turbo on that package's files only (`turbo.json`, `ci.yml:70-72`): moved to `scripts/` (`test:scripts`, uncached), reading sources. MAJOR assumptions — ADR-012 (`:24-31`) and SECURITY_POSTURE (`:44-49`) hold their own cookie lists and the no-consent reasoning: both updated in commit 2, assumption 12. MINOR — a waiting photo is also seen by its sender in the personal space (texts fixed); rebuild i18n before the specs; no "any" in the `legal.ts` comment. Security clean; migration n/a (no schema, no engine).
- **Pass 2**: MINOR — the cookie walk must not read `.astro` or `apps/web-marketing` (the policy vouching for itself); Prettier on the changed docs. Folded. **CONVERGED — 2 passes, 0 MINOR/NIT remaining** (open questions A-C stand).
- **Cold plan-reviewer (opus)**: 3 BLOCKER, 4 MAJOR, 9 MINOR, 3 NIT; each checked in code before folding. BLOCKER — the QR send logs `actorId` + headers (ruling 476, Task 0); `@supabase/ssr` leaves a script-readable Google session cookie the walk cannot see (ruling 477, its own slice first; `LIBRARY_COOKIES`); `mc_staff` lasts 12 h for a photos login after the close (text). MAJOR — Scaleway serves the images to every viewer (§7 row); no legal basis (§4 rows); the walk's quote rule (`'` and `"` only); the Photos tab is gone for a person no longer on the roster ("write to us"). MINOR folded into the texts: the export holds personal-space photos only, Keep erases the reports shown, orientation + preview copy, `device_id` on the row, the sign-up name fallback, the zip holds waiting photos and tag/status, "write to us" is a hand deletion (assumption 13), `sb-access-token` is 30 days, `privacy-date` can be cached (safe here: the `.astro` files change too). Open questions D-F added.

## As built (2026-11-06)

- **Order kept.** Fix 477 pushed alone first (`6b34a1bb`, CI green on every job). Then six commits in one push: `d5a9b832` (Task 0, log), `1911378f` (Task 1, photos in the policy, version 2026-11-06), `8a841c68` (Task 2, cookies and counts), `07acc561` (Task 3, the link), `a1e6bff4` (ruling 479, wording), `837e3dc1` (the cookie walk reads app top-level files).
- **Task 0**: the pattern is anchored at `/api/v1/events/`: an end-anchored one would also have caught the signed-in send `/api/v1/me/events/…/photos`, which must keep its log (a control test holds it). Falsified, each break proven in the file: no method check → RED (a GET control); no query strip → RED (2); no `report` branch → RED (2); no start anchor → RED (the `/me` control); the middleware ignoring the rule → RED (4). 11 tests.
- **Task 1**: the texts as approved. `privacy-date` RED with one date line changed, restored. i18n parity green.
- **Task 2**: RED first naming `mc-oauth-…-code-verifier`, `mc_photo_device`, `mc_staff`, `mc_theme`. §9 lists eight cookies. Falsified: `mc_theme` row gone (EN) → RED; `mc_fake` row (FR) → RED; `PHOTO_DEVICE_COOKIE` renamed → RED; `OAUTH_STORAGE_KEY` changed → RED naming the source line. `LIBRARY_COOKIES` holds the one Google entry; `@supabase/ssr` is gone, so no library-named cookie remains.
- **Task 3**: both specs RED (no link), then 19/19 in the two photo spec files, axe included. Falsified: no `target` → RED (2); no `#photos` → RED (2); the FR key renamed → the i18n build fails. `PhotoNotice` 18 lines, `PhotoForm` 45.
- **Gates**: 33/33 after commit 3; the review fixes are a wording change, a comment and a test (re-run before the push).
- **Cold code review (opus)**: 0 BLOCKER, 1 MAJOR, 3 MINOR, 2 NIT; every §3bis fact and every cookie lifetime checked in the code and found right. MAJOR — Fastify's own request line (`main.ts:22-27`, `logger: true`) writes every caller's address, and a signed-in page load writes the same address beside the account, so "nothing links this photo to your account" was false of the logs: **ruling 479**, the operator's rewording, no code change. MINOR fixed — the cookie walk skipped app top-level files (a seed there stayed green; now RED). Named, not fixed: database backups keep photo names, captions and report comments up to `BACKUP_RETENTION_DAYS` (open question B); the new-tab link has no "opens in a new tab" cue for screen readers (WCAG advisory G201; `LegalConsent` has none either); the delete card's `deleteSubtitle` does not mention photos (`dataRetentionBody` beside it does); a hand-made percent-encoded path (`%70hotos`) would log the actor (no real client sends one). Open: can a platform super admin see waiting photos (the policy names club admins and the photos volunteers only)?
