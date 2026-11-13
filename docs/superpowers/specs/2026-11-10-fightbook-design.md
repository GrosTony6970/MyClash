# FightBook — design

> Status: design, from a brainstorm with the operator on 2026-11-10 (rulings 642-661), converged
> after two review passes. Built slice by slice, each planned with `superpowers:writing-plans`.
> "Q1"-"Q4" below are rulings 658-661.

## Context — why this exists

At a HEMA Event, people free-spar between Workshops and Tournament Pools. Three things go wrong today:

1. **People forget.** They say yes to several people and lose track of who and how many.
2. **People can't say no.** With the person in front of them, they say yes to a spar they don't want.
3. **People don't dare ask.** Shy fighters never ask at all.

FightBook is a "dating-app" style tool for friendly spars: ask a fighter, they answer yes or "not
this time" in private, and every yes lands in a personal list. It lives in the fighter's personal
space under a new **FightBook** menu entry.

**Success:** at the next Event, fighters arrange spars through FightBook; nobody double-books
themselves or forgets a promise; a "no" costs nobody face; shy fighters get spars they would not
have asked for in person.

## Goals

- Ask a fighter for one friendly spar, privately, before the Event or on the day.
- Answer privately: Yes, or a soft "Not this time".
- A reliable list of every spar you agreed to, and which ones happened.
- Reviews that serve three purposes: thank the partner, keep a private note, flag a safety issue.
- Private favourites.

## Non-goals

- **Not scoring.** A spar has no Exchanges, no score, no ruleset, no referee. It never touches
  `@myclash/rulesets`, Matches, Pools or the scoring app. It does not need to work offline.
- Not chat. One optional message on the request, one optional comment on the answer. No threads.
- No piste booking or scheduling-board integration. A spar's time is information, not a reservation.
- No intensity level (Light/Medium/Hard) in v1 — offered and declined by the operator.
- No public review text. Only a count and (optionally) an average.

## Anti-goals (failure even if it "works")

- A "no" that the asker can read as personal rejection. (Every "no" reads the same and arrives
  at once; an asker may still _guess_ an instant one was automatic — operator accepted this for
  speed, Q3.)
- A harasser who can keep asking after being refused.
- A public star score that brands a beginner from one harsh review.
- A safety flag that the flagged person can see or trace through the app. (Organisers do see the
  reporter — operator ruling; what they tell the flagged person is their judgement.)
- Any piece of FightBook that lets a stranger learn where someone is or who they spar with.

## Vocabulary

- **Spar** — new noun: one friendly, unscored meeting between two fighters, with one or more weapons.
  It is not a Match and has no Exchanges. Add it to `docs/HIERARCHY.md` as a sibling outside the
  Tournament tree (operator ruling needed per CLAUDE.md only if it conflicts — it should not).
- **Fighter** stays a role: FightBook keys on `global_persons` (one row per human across Events),
  per `docs/HIERARCHY.md`. The signed-in user's fighter = `global_persons.claimed_by_user_id`.
- **Spar request**, **open call**, **review**, **safety flag**, **favourite**, **block** — defined below.

## Decided behaviour (operator's words, made precise)

### Who can ask whom

- **Anyone on MyClash** with a claimed fighter profile can ask any other fighter.
- **Priority to people at the same Event**: in "Find a partner", fighters registered for the
  current Event (a `persons` row with that `event_id` and a `global_person_id`) come first.
- **Opt-in / opt-out**: one switch per fighter, on the profile settings, like
  `allow_being_followed`. When off: nobody can ask them, they do not appear in Find, the "Ask to
  spar" button is hidden on their profile, and they cannot ask others either (symmetry — _my call_).
  Default value: **off** (_my call_ — FightBook is new social exposure; opt-in is the safe
  default and matches the "Same Event, opt-in" spirit of the answer).

### Eligibility (_my calls_ unless marked)

- FightBook needs a **claimed fighter profile** (`global_persons.claimed_by_user_id`). A
  signed-in user without one sees the FightBook page with the existing "claim/create your fighter
  profile" path, not FightBook itself.
- **Age**: no age rule (operator ruling). Same rules for everyone; organisers handle it as for
  sparring today.
- **"Same Event"** = has a `persons` row for that Event (any role — fighters, staff, Workshop-only
  attendees all spar). **Current Event** in Find = the Event the fighter has a `persons` row for
  that is running today (Event clock); if several, a picker; if none, the next upcoming; if none,
  Find has no Event block. Below the Event block (or alone), Find browses **all FightBook users**
  (rulings 673, 675): by name, 20 per page with "Show more", narrowed by an optional name and an
  optional weapon, and every Find card shows the fighter's photo.

- **Find ignores the directory opt-out** (`listed_in_directory`, 0187): Find lists only FightBook
  users, to signed-in FightBook users, so the FightBook switch is the one control (_my call_).

### A request

- One request = **one spar** that may use **several weapons** (from `weapon_catalog`), with an
  **optional time**, an **optional message**, and **either an Event or a free date + place**.
- **A day is required** (review pass 1): an Event request picks one of the Event's days (the daily
  limit and "grouped by day" need one); a free-date request has its date. Free-date times are kept
  in the asker's browser time zone, stored with the request — only Events store a zone (0102).
- Ask from three places: a fighter's public profile, the Event's people list
  (`/e/[eventSlug]/people`), and the **Find a partner** tab.
- Recipient gets a push notification (email fallback per the existing delivery rule), opens the
  request, sees the asker's fighter profile, the weapons, the time, the message.

### Answering

- **Yes** → the spar enters both fighters' FightBooks as _agreed_.
- **Not this time** → the asker sees only "Not this time". The answerer may add a comment and
  choose whether the asker sees it (default: private — _my call_).
- **Unanswered** requests expire at the end of the requested day: for an Event day, 06:00 the next
  morning on the Event clock (`eventOpenWindow`, `apps/api/src/common/event-open-window.ts`,
  ruling 154); for a free date, end of that date in the stored zone. The asker sees "Not this
  time" on expiry — indistinguishable from a decline (serves anti-goal 1).
- **One rule for every "Not this time"** (review pass 1): manual decline, daily limit, block and
  expiry all end the request in the same state and the same asker-facing payload. **Timing:
  right away, every time** (operator ruling Q3) — the asker sees "Not this time" as soon as it
  happens; no delay is added. Tests assert the asker-facing payload is byte-identical across all
  four paths (an optional visible comment is the decliner's own choice to reveal more).
- **No re-asking** (_my call_): after "Not this time" (any path), the same asker cannot ask the
  same fighter again for the same Event, or within 7 days for free-date spars. The receiver can
  still ask them. Asking is also rate-limited per account (`common/throttling/throttle-profiles.ts`).
  Persistent unwanted asks across Events are what block is for.
- **Withdraw / cancel** (_my call_): the asker can withdraw a pending request (the receiver's
  card just disappears). Either fighter can cancel an agreed spar with an optional message; the
  other gets a notice "Spar cancelled" — honest, since both already said yes.
- **Daily limit** (optional, per fighter, per day on the Event clock): "I'll do N spars today".
  Once N agreed spars that day, new requests for that day are answered "Not this time"
  automatically. The asker cannot tell it was automatic.
- **Block** (reworked in review pass 1 — the first version leaked): the blocked fighter is not
  told and **sees nothing change**. They still see your profile and "Ask to spar" button; any
  request they send lands nowhere and ends as "Not this time" on the common rule above. You
  stay listed in _their_ Find and still show them "Ask to spar"; their asks end "Not this time"
  (ruling 672). Your own Find and buttons hide the fighters you blocked. Open-call lists (slice 5)
  ~~keep the first design: you disappear from _their_ open-call lists only where absence is normal.~~
  _Overturned in slice 5 (ruling 706): the blocked fighter still sees the blocker's open calls and
  may answer "I'm in"; the poster never sees that answer, and the fighter gets "Not this time" when
  the call closes or another is picked. The poster's own lists hide the calls of fighters she
  blocked._
  Blocking never touches an already agreed spar — you cancel it the
  ordinary way if you want to. Pending requests between you end as "Not this time" on the common
  rule. Unblock from a list in FightBook settings.
- **Reminder**: push 10 minutes before an agreed spar's time, to both fighters (only when a time
  was set). Respects notification preferences ("off means off", ARCHITECTURE §11ter).

### Finding a partner

- **Ask from their profile** — "Ask to spar" button on `/fighters/[slug]` and on the Event people
  page, shown when both sides have FightBook on (block deliberately does **not** hide it — above).
- **Visibility on public pages** (_my call_, serves anti-goal 5): those pages are open to signed-out
  visitors. The "Ask to spar" button and the "free now" badge are **never in the public page
  data**; they load in the browser from an authenticated FightBook endpoint, and only for a
  signed-in viewer who has FightBook on. The public "Sparred N times" / stars line is the only
  FightBook data in the public projection.
- **"Free now" and open calls are seen only by people at that Event** (review pass 1): the viewer
  must have FightBook on **and** a `persons` row for that Event. Otherwise any account could switch
  FightBook on and learn who is at the venue right now (anti-goal 5).

> **Built in slice 5 (rulings 705-714), where it differs from the three lines below.** "Free now"
> shows only in Find's Event block (708). An open call is for today at a time, a fighter may hold
> up to 5 at once (710), and others see just the call, never who answered (712). A QR code lasts 5
> minutes and works for one scan (711). A scan works anywhere: at an Event day both are on, or at a
> place the scanner types (709). Details: `docs/ARCHITECTURE.md` §11septies.9.

- **"Free to spar now"** — a switch scoped to one Event; shows the fighter with a "free now" badge
  in Find and the Event people list. Turns itself off after **1 hour** (_my guess, confirmed in
  playback_) or when switched off.
- **Open call** — "Looking for a [weapons] spar at [time]" posted to one Event. FightBook users at
  that Event see it in Find and can answer "I'm in". The poster picks one; the pick becomes an
  agreed spar; others see "Not this time". Closes at its time or end of the Event day.
- **Log by QR scan** — two fighters who agreed face to face: one shows a **FightBook QR**, the
  other scans it, picks weapons, and ~~the spar goes into both FightBooks as agreed (or straight to
  done — builder's call)~~ _the scan sends the shower a spar request (Yes / "Not this time"); the
  spar is agreed on her Yes (rulings 707, 713). A scan by a fighter she blocked never reaches her
  Inbox, sends no notice, and waits as "sent" until its day ends, then reads "Not this time", exactly
  as a request she ignored (ruling 714)_. The FightBook QR is **separate from the Event pass QR** (`event_passes`)
  so a scan can never check anyone in. The QR must be short-lived or one-time so a screenshot can't
  be reused to add spars to someone's book (_my call_). A scan requires both sides to have
  FightBook on and is refused by a block (same "nothing happens" face as an ask); it skips the
  daily limit — they agreed face to face (_my call_).

### After the spar

> **Built in slice 3 (rulings 677-690), where it differs from the lines below.** "We sparred"
> opens at 00:00 of the spar day and, with its undo, closes 48 h after the day ends; a review opens
> when that closes, so no review ever sits on an undoable spar. The review is a signed thank-you
> (stars, optional text) or an anonymous review (stars only); the private note is separate. The
> safety flag is slice 4 (built, below). The star average is live, not batched, and shows from the first review
> when the fighter switches it on. Details: `docs/ARCHITECTURE.md` §11septies.7.

- **"We sparred"** — either fighter marks an agreed spar done; the other can undo **until either
  fighter has written a review** (review pass 1: otherwise the flagged fighter could undo the spar
  out from under a flag). After that, undo is refused with one wording that does not say why.
  _Built: undo closes at 48 h after the spar day; reviews open then._
  Only done spars count anywhere (public count, reviews, favourites list context).
- **Review** (one per fighter per spar, on a done spar only), one form with three parts, each
  optional:
  - **Thank-you**: 1–5 stars + optional text to the partner, **named or anonymous** (reviewer's
    choice). **Named**: the partner sees name, stars, text and which spar. **Anonymous** (operator
    ruling): adds stars to the average only — the partner never sees its text, nor which spar it
    was about, nor any per-review row. The form hides the text field when "anonymous" is ticked.
  - **Private note**: text only the writer ever sees.
  - **Safety flag** (_Built in slice 4 (rulings 691-701), where it differs from the lines below:
    the form opens at 00:00 of the spar day, on its own apart from the thank-you; a cancelled spar
    can be flagged; the reporter sees "sent" only; while no account holds the flagged profile the
    flag shows to super admins only; the alert passes the main switch by email. Details:
    `docs/ARCHITECTURE.md` §11septies.8_): a reason + text. Goes to the Event's organisers (Event spar) or MyClash
    platform admins (free-date spar). Operator ruling: recipients get an **alert** (push/email via
    the notice pipeline) and an **admin list** in web-admin showing reporter, flagged fighter,
    spar, reason, text, and a "handled" mark. Never shown to the flagged fighter, never counted
    in stars.
    - **"Organisers" = admins of the Event's club** (`organisersEvent` / `moderatorsEvent`,
      `apps/api/src/modules/photos/photo-organiser.ts:30-62`). **The flagged fighter's own account
      is removed from both the alert recipients and the list's readers** even when they are a
      club admin; if no one is left, the flag goes to platform admins (review pass 1 — in a small
      club the flagged fighter is often an admin).
    - Copied from the photo-report queue (0252): only the closed table (RLS on, no policy, API
      writes) and the club-or-super-admin gate. Not copied: its anonymous-device reporter and
      its delete-with-photo lifetime. A flag has a named reporter and outlives the spar.
    - **New work**: no notice today reaches club or platform admins (nothing in `notifications/`
      reads `organization_members` / `platform_role`) — slice 4 builds that recipient lookup.
      The alert obeys "off means off" (ruling 200); the admin list is the durable record
      (_my call_). Alert text carries no names and no reason (it shows on a locked phone,
      `apps/web-public/public/sw.js`).
    - **Export** (operator ruling Q1): flags about the subject are **left out** of their subject
      export — a spar has one partner, so any flag text names the reporter (Art. 15(4)). This is a
      deliberate departure from the gear-check precedent (`subject-export.tables.ts:92-97`) and
      must say so. The reporter's own flags are exported to the reporter. _Built:_ `spar_flags` is
      in `SUBJECT_EXPORT_TABLES`, reaching the reporter only, so the reporter's download carries
      their flags and the subject's carries none. The excluded table is `spar_flag_admin` (the
      "handled" mark and the flagged account), which sits in `SUBJECT_EXPORT_EXCLUDED_TABLES`; the
      coverage test lets a table sit in one set only.
    - **Retention** (operator ruling Q4): a flag is deleted **2 years** after it was made
      — a new horizon in the retention settings row beside `guest_session_days` / `audit_log_days`
      (`apps/api/src/modules/privacy/retention.service.ts:85-137`), default 730 days, with a test. If the reporter's account is erased, the
      flag stays with the reporter link cleared; if the flagged fighter's account is erased, the
      flag is deleted with their FightBook rows.
- **Public profile** shows: "Sparred N times" — **always**, for anyone with FightBook on — and
  "★ x.x (k reviews)" only if the fighter allows it **and** k ≥ 5 (_my guess, confirmed in
  playback_). No review text is ever public.
  _Overturned (ruling 689): the stars show from the first review, when the fighter allows it. "Sparred N" counts spars done and settled (48 h past the day)._
- **The star average and k refresh in batches** (review pass 1): only once at least 3 new reviews
  have arrived since the last refresh. Otherwise the partner subtracts the named stars they can see
  from average × k and reads an anonymous review's stars, and the moment k moved names the spar.
  The partner's own view of their average follows the same refresh.
  _Overturned (ruling 688): the average moves after each review. The batch rule was dropped; an
  anonymous writer stays unnamed (no card, list or download names them), and the guess from timing
  is accepted._
- **Favourites**: a heart on a partner. Private; the partner is never told (same rule as Follows,
  ARCHITECTURE §11quinquies).

### Screens (web-public)

- **FightBook** entry in the personal-space side menu (`PublicPersonalShell` `navItems`) only. Not in the
  phone bottom bar. **Label "FightBook"**, with a **drawn Lucide glyph** like every other entry
  (operator ruling Q2 — `NavIcon` replaced two-letter tiles "that nobody decoded",
  `packages/ui/src/components/NavIcon.tsx:15-17`). New semantic name (e.g. `fightBook`) added to
  `NAV_ICON_NAMES`/`NAV_ICON_GLYPHS`; the glyph file is generated
  (`node packages/ui/scripts/generate-nav-icons.mjs`) and `nav-icon-glyphs.test.ts` regenerates it.
  Glyph choice (swords, handshake…) left to the builder.
- FightBook page with **four tabs**: **Inbox** (requests waiting for my answer, with a count badge),
  **My spars** (agreed, then done, grouped by day; requests I sent, pending), **Favourites (♥)**,
  **Find a partner** (same-Event fighters first, free-now badge, open calls, filters by weapon).
- A **FightBook settings** panel: on/off, daily limit, blocked list, star visibility.
- Request card: photo, name, club, weapons, time, message, [Yes] [Not this time].

## Constraints (from this repo's rules)

- **RLS on every new table**; writes go through the API only (0247 pattern). Block and favourite
  data must never be readable by the other party; safety flags readable only by the API on behalf
  of organisers/admins (deny-all RLS like `event_photo_reports`).
- **Authorization** on every route (global AuthGuard; route-authz ledger test must classify each
  new handler).
- **i18n**: every string in `en` and `fr`; notification wording only in
  `apps/api/src/modules/notifications/notice-texts/notice-texts.ts` (FR then EN).
- **Notifications**: new preference toggles join `notification_preferences` (one column per toggle);
  "off means off".
- **Privacy — subject export**: every new table goes in `SUBJECT_EXPORT_TABLES` or
  `..._EXCLUDED_TABLES` (`apps/api/src/modules/privacy/subject-export.tables.ts`; the coverage test
  forces it). What the subject wrote or asked is theirs. Blocks and favourites _aimed at_ the
  subject are excluded (Art. 15(4), same as follows, lines 31-34). Flags about the subject are
  excluded (Q1, above). Anonymous reviews about the subject: excluded for the same reason as
  flags (their text and timing would name the writer) — _my call_, follows Q1.
- **Privacy — archive**: every FightBook table is listed as **excluded** from the organiser
  archive (`apps/api/src/modules/exports/archive.tables.ts`) — spars are private, not the Event
  record.
- **Privacy — erasure**: FightBook rows join the hand-written delete lists in
  `apps/api/src/modules/privacy/erasure.service.ts` (owned rows ~l.101, rows aimed at the erased
  profile ~l.127), each with a test — those lists have no coverage gate of their own.
- **Fighter merge**: `merge_fighters` and its revert (migration 0212) move follows by hand; every
  FightBook table keyed on `global_person_id` joins them, or a merge silently drops a block. A
  CHECK forbids a spar/request/block between a profile and itself (a merge could produce one).
  Run `scripts/db-merge-probe.mjs`.
- **Races** (CLAUDE.md "Name the race"): every state change is one conditional update
  (`… WHERE status = <expected>`), so answer-vs-withdraw, answer-vs-expiry, cancel-vs-done and
  open-call double-pick resolve to one winner and the loser gets a "no longer open" refusal.
  The daily limit counts under a lock on the answerer's day (two "Yes" taps in parallel cannot
  both pass N). The 7-day free-date no-re-ask cannot be a unique key (NULL Event never collides) —
  it is checked in the same conditional insert.
- **Authorization**: the global AuthGuard runs in shadow mode (`route-authz-ledger.ts:7-8`), so each
  handler carries its own refuser (a `me`-scoped path), refuses staff logins and guest tokens like
  `FightersController.list`, and is classified in the route-authz ledger.
- **Gates that will need entries** (list them in each slice plan): `CHECKS` in
  `alert-visibility.ts` and `WANTED` in `alert-still-wanted.ts` for every new notice kind (the
  reminder's must re-check the spar is still agreed); ARCHITECTURE §11ter.2 table and
  `PREFERENCE_TOGGLE_COLUMNS`; `quality:openapi-drift`; `db:review`; the public-fighter key pin in
  `fighters.service.test.ts` when the count/stars line joins the projection; the i18n sweep.
- **Migrations**: numbering is max+1 at commit time (0259 today); verify the post-migration schema
  rather than trusting the run.
- **No raw IDs in UI**; no real names in fixtures (public AGPL repo).
- **Time** on the Event clock: `eventZone` (`apps/api/src/common/event-clock.ts`) and
  `eventOpenWindow` — same pattern as Workshop check-in.
- **Notices to one account** reuse `sendImmediate` / scheduled reminders in
  `apps/api/src/workers/notification-scheduler.worker.ts` (push first, email fallback,
  preference gating); FightBook kinds widen `ImmediateNotificationKind` / `ScheduledNotificationKind`
  and let the compile errors be the checklist.
- One concern per commit; gates via `myclash-gates`.

## Build order (suggested slices)

Estimate: **~75 commits (60–90)** at this repo's one-concern-per-commit pace — slice 1 ≈ 20–25,
2 ≈ 8–10, 3 ≈ 12–15, 4 ≈ 10–12, 5 ≈ 12–15, 6 ≈ 6–8, each including ~20 % review/gate fix commits
(Workshop check-in 2.4 took 19).

1. **Core**: opt-in switch, request (Event or free date, weapons, time, message), Inbox, answer
   Yes / Not this time, no re-asking, withdraw/cancel, **block**, My spars list, expiry, push
   notification. FightBook menu entry + icon. (Block moved here from slice 5 — _my call_: it is the
   anti-harassment floor and must ship with the first way to ask.)
2. **Asking surfaces**: "Ask to spar" on profile and Event people page; Find a partner tab with
   same-Event priority.
3. **After the spar** (built, rulings 677-690): "We sparred" + undo; reviews (signed thank-you,
   anonymous review, private note); public count + optional live star average from the first
   review (the batch rule and "from 5 reviews" are overturned); favourites.
4. **Safety flags** (built, rulings 691-701): flag form, organiser/admin alert, web-admin flag list
   with "handled".
5. **Floor tools** (built, rulings 705-714): Free to spar now, open call, FightBook QR log. Two
   lines overturned: the blocker is not hidden from open-call lists (706), and a QR spar is not
   agreed on the scan (713, 714).
6. **Comfort**: daily limit, 10-minute reminder.

## Left to the builder

- Table shapes, names, indexes; API route shapes; whether the open call is its own table.
- Whether a QR-logged spar starts as agreed or done.
- Exact copy (en/fr), within the tone above.
- Push payload and deep link (`sw.js` already opens the payload `url`).
- Find's query shape (it does not honour `listed_in_directory` — above).
- What happens to FightBook rows when their Event is deleted (keep the spar, null the Event link,
  is the default to beat).

## Verification

- Each slice: API unit/integration tests for the state machine (asked → yes / not-this-time /
  expired / cancelled-by-block → done ↔ undone), authz tests (a stranger cannot read another's
  requests, blocks, favourites, notes, flags), RLS tests on each table, i18n sweep green,
  subject-export and archive coverage tests green, web-public screen tests for the four tabs.
- Falsify the privacy guarantees: delete the guard, prove the break landed, and watch a test go
  red — each named:
  - the four "Not this time" paths give a byte-identical asker payload;
  - a flag about the subject is absent from their export and present in the reporter's;
  - the retention job deletes a flag older than 2 years and keeps a younger one;
  - a blocked asker's profile view and ask response equal an unblocked one's;
  - an anonymous review never appears in the partner's review list, and the average does not move
    until 3 new reviews;
  - a flag's alert and list never include the flagged fighter, also when they are a club admin;
  - undo is refused after a review, with the generic wording;
  - "free now" and open calls are refused to a FightBook user with no `persons` row at the Event;
  - stars hidden below 5 reviews or when switched off;
  - a merge moves blocks to the survivor; erasure deletes each FightBook row it lists.
- Every DB-read test asserts the SELECT string (mocks ignore the projection).
- Full `myclash-gates` chain before each push; manual pass at the operator's next live Event.
