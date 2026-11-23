# myclash.md — Functional & Design Reference

> Product-level understanding of MyClash. This document focuses on **what the app does and feels like**, not how it's built.
>
> For technical architecture, see `docs/ARCHITECTURE.md`.
> For repo orientation, see `README.md`.

---

## Overview

MyClash is a free, open-source platform that lets HEMA event organizers run their events end-to-end and publish results — while giving competitors, spectators, referees, and workshop attendees a single mobile-first experience for everything they need on event day.

It replaces the patchwork of tools currently used: hemaScorecard for brackets, spreadsheets for schedules, static HTML pages for results, paper for refereeing. MyClash unifies these into one platform with three coordinated surfaces (public app, staff tablet PWA, organizer admin) and a shared backend that captures every exchange.

It is designed around three convictions:

1. **Real HEMA events happen in spaces with bad wifi.** Offline-first scoring is the quality bar.
2. **Per-exchange data is the only honest source of truth.** Aggregate scores derive; raw exchanges persist.
3. **An Event keeps its own face.** Its logo, its hero image and the organiser's own words make a platform feel like a local event. The design language is the same everywhere.

---

## Features (v1)

### For event organizers

- Create an event site with its own logo, hero image and description at `app.myclash.fr/e/[slug]`. Create it with a four-step wizard (basics, venue, branding, review), and choose whether people may join the Event themselves.
- Define multiple tournaments (weapon × category) within an event, each with its own ruleset.
- Configure Lices (pistes) — multi-Lice scheduling.
- Register fighters individually or via CSV import (with downloadable templates); suggest matches against global fighter database and HEMA Ratings.
- **Pool populator** with configurable constraints: school separation, skill balancing using HEMA Ratings, manual override.
- **Referee assignment**: manage referee qualifications (a role is a referee skill the federation defines, per-role rating 1–5; three are seeded as a default), configure which slots each phase needs, auto-assign with constraint solver, see missing-role report, manually override. Record each referee's availability, set their compensation, and read the compensation report.
- AI setup assistant creates reviewed drafts for tournament configuration, pool plans, brackets, exact match-grid scheduling, and referee assignments using the organizer's BYOK key.
- Natural-language tournament query lets organizers ask French or English questions such as "Quelles pistes sont en retard ?" or "Top 5 fighters by win rate"; AI selects a typed read-only tool and deterministic backend code renders the answer.
- **Organizer chatbot**: a conversational, tool-using assistant that streams its progress over SSE — distinct from the one-shot setup-draft assistant and the read-only query panel.
- **AI model registry**: per-organization provider and model selection across Anthropic, OpenAI, Mistral and Google (Gemini) adapters.
- **AI consumption dashboard**: per-organization usage summary with budget caps, spend-cap enforcement, and AI feature flags.
- **Generated content**: AI-drafted, publishable tournament recaps, organizer content, and fighter performance insights (generate → publish/unpublish).
- Generate single-elimination brackets from pool standings, including arbitrary-size fields with play-in matches for low seeds, then publish or unpublish pool/bracket visibility independently when ready. Double elimination and Swiss rounds are available too, and a bout can be best-of-N rounds.
- Penalty cards from a penalty list per ruleset, and a **protest limit** per Tournament: past the limit, the scoring pad offers the penalty the organiser chose.
- Override a result when the score sheet was wrong, and lock a Tournament's rules once bouts are scored; both are recorded in the audit log.
- Record fighter forfeits from scoring/admin. The penalty ruleset sets what each one does (injury, voluntary withdrawal, conduct violation, black cards): the bout keeps its score, is a 0-X loss, or is a draw on a Pool or Swiss bout; the fighter continues, is asked about, withdrawn, or disqualified; "disqualify after N forfeits". A Tournament can change these rules until a bout is scored. Includes pool auto-forfeits and bracket walkovers/replacements.
- Schedule matches on a day grid, and workshops on their own board — two boards, and two separate public pages. The workshop board warns, in red, when two workshops share a room at once, or when an instructor would be teaching elsewhere, refereeing or fighting at that time.
- Manage workshops: instructors (optional fighter link, bio and photo), descriptions (with a one-line catalogue description and the prerequisites, which the instructor can edit too), sessions, capacity, waitlists (a Workshop can keep none: a full session then says "Full", and the instructor can switch it too). A Workshop can have several dated sessions, each with its own seats, waiting list and roster; a cancelled session stays visible, struck through. From a session's roster, add one of the Event's people (a full session puts them on the waiting list), print or export it as a sign-in sheet, and tick who is in the room (the instructor can too, from their dashboard). A Workshop can let the front desk tick its people on the day they arrive; a tick never changes a booking.
- **Leagues / Classement**: org owners run multi-tournament leagues that aggregate standings across linked events/tournaments, with per-league organization and user roles, tournament/event linking and membership requests, on-demand recompute, and a public final report (CSV + printable HTML) export — managed in web-admin `/org/[slug]/leagues` and surfaced for competitors under `/me/leagues`.
- Send event-wide notifications to everyone, fighters, referees, fighters and referees, Workshop attendees, instructors, or selected people with Info, Warning, and Alert severity; message the people booked in one Workshop session from its roster; pool/bracket publish flows can prefill an editable "ready" broadcast.
- Publish results, rich statistics, and export to CSV/JSON/PDF/HEMA Ratings format.
- **Archive & restore**: export a lossless, round-trippable JSON archive of a whole event or tournament, then restore it (with a restore-preview step) as a distinct backup/migration path, alongside the flat CSV/JSON/PDF/HEMA-Ratings exports.
- **Event photos**: switch photos on for an Event (off, live at once, or approve first), print the QR poster, approve or delete what people send, read the reports, and download every photo as one zip. Every photo is deleted 30 days after the Event.
- **Event day**: a live control room and a day view of every piste; staff logins by job (scoring, check-in desk, gear check, photos), each with a PIN; a simulated clock to rehearse the day before it happens.
- **After the Event**: collect feedback from the people who came, and read it in a debrief.

### For scorekeepers and Event-day staff

- Tablet-first PWA, installable, **fully offline-capable**. Sign in with the Event code, a username and a PIN.
- Per-exchange entry: clean hits (1pt/2pt), afterblows, doubles, no-exchange — large gloved-finger-friendly buttons.
- Penalty cards, and **protests**: one tap when a fighter disputes a call. A protest is counted for the fighter and never changes the score.
- Match clock with halt/resume; best-of-N rounds.
- Undo the last entry (a hit, a card or a protest).
- Always shows explicit network/sync state. A whole bout can be scored with no network, and the next bout opens offline too. "Practice going offline" is a drill that rehearses it.
- **Check-in desk**: tick people in as they arrive, by name or by scanning their Event pass.
- **Gear check**: record whose equipment was checked.
- **Photos**: a volunteer with the photos job approves and deletes the Event's photos.

### For competitors

- A personal space: "my next match", "my pool", "where I need to be".
- Sign in with a password, a link sent by email, or Google.
- Live results across all events.
- Workshop catalog with one-tap enrollment. Joining a Workshop can join the Event too, when the organiser allows it.
- **Event pass**: a QR code the check-in desk scans.
- **FightBook**: find a sparring partner. Switch it on, then ask a fighter for a spar from their profile, from the Event people page, or from "Find a partner". Answer requests in an Inbox, keep agreed spars in "My spars", mark "We sparred", send a thank-you with stars, keep a private note, star your favourites, block a fighter, and report a safety problem. At a running Event: say "Free to spar now", post an open call, or log a spar by scanning the other fighter's QR code. A daily limit caps the spars you accept, and a reminder comes 10 minutes before each one.
- **Photos**: send photos to one of your own Events from your personal space, see their status, and delete them.
- A public fighter profile, listed in the fighter directory or hidden from it, as you choose.
- Download all your data, or delete your account.
- **My Schedule**: unified view of fights, refereeing, workshops with conflict markers.
- Push notifications for upcoming matches, workshops, schedule changes.
- Claimed fighters can change their login/contact email after confirming a link sent to the new address.
- **Self-service AI insight**: save a personal BYOK AI key, then generate and publish/unpublish your own performance insight.

### For referees

- Schedule overlaid in My Schedule with role labels.
- A private referee history in the profile, with the protests faced per Match.
- Not built: confirming or declining an assignment, and on-piste tools. An assignment is the organiser's to lock; the clock and the cards are the scorekeeper's.

### For workshop attendees

- Browse catalog by day/category/level/language/instructor/weapon.
- Enroll; see waitlist position when full; auto-promote when a spot opens.
- Notifications for cancellations and promotions.

### For spectators / accompanists

- **Search any participant** in the event — fighters, referees, workshop leads.
- **People Hub**: a persistent, cross-event personal directory. Follow people by their global identity (not just within one event) and organize them into named, reorderable groups — e.g. a coach's students — surfaced under `/me/follows`.
- **Watchlist / group view** shows next-match / live-now / just-finished state for everyone you follow, per group, all in one screen.
- Live Lice view: current and upcoming matches.
- **Push notifications** when someone you follow is about to fight (claimed accounts only — verifies email ownership).
- Live exchange feed during matches.
- **TV and projector screens**: a scoreboard per bout, a screen per piste and one for the whole Event, with each fighter's cards and protests. A screen can swap sides, go fullscreen and stay awake.
- **Event photos**: the Event's photo page, newest first, with a Report button on each photo. Anyone at the venue can send photos by scanning the QR poster, with no account.
- Public pages for Leagues and for the fighter directory.
- Following works for anonymous users too (saved on their device), but push notifications and cross-device sync require a quick magic-link claim.

### For club admins

- Read the FightBook safety reports about spars at the club's Events, and mark each one handled.

### For platform admins

Three tiers: super admin, platform admin and platform viewer (read only).

- Manage organizer accounts: approve, suspend, reactivate, reassign the owner, delete.
- Moderate global fighter profiles (merge duplicates).
- Approve community-submitted rulesets.
- Audit log review.
- Moderate any Event's photos, and read the FightBook safety reports that belong to no club.
- Manage the weapon catalogue (super admins only).
- Backups and restore, data retention, and a system page with the health of the database, disk, photo storage, Redis and each job queue.

---

## User journeys

### Competitor on event day

1. Opens `app.myclash.fr/e/fal2026` on phone.
2. Logs in (or already logged in from prior visit).
3. Lands on their personal space: "Your next match — Pool A on Lice 1 at 10:30. Check in at registration desk."
4. Throughout the day, gets push notifications 10 min before matches.
5. Between matches: opens My Schedule to see what's next, including their afternoon workshop.
6. Has a free hour: opens FightBook, says "Free to spar now", and answers a request from a fighter she has never met.
7. If their contact email changes, opens profile email settings, enters the new address, and confirms the link sent there.
8. After the organizer publishes pools or brackets, views their pool standings live; sees their final ranking when published.

### Scorekeeper at the piste

1. Borrowed tablet at Lice 2; PWA pre-installed.
2. Logs in once at start of day, with the Event code, a username and a PIN.
3. UI shows: "Lice 2 — Pool C, Match 1: Alice (red) vs Bob (blue), Longsword".
4. Taps "Start match" → clock starts.
5. Alice strikes Bob's head (2pt clean). Tap red → 2pt → clean. Confirmed.
6. They strike simultaneously (double). Tap "double".
7. Bob disputes a call. Tap Bob's protest button: his count goes to 1, the score does not move.
8. Match ends. Tap "End match" → score finalized; queue advances.
9. **At any point, wifi can drop**: queue grows in IndexedDB outbox. UI shows "offline · 7 pending". Reconnect → silent sync.

### Organizer pre-event

1. Creates event; adds its logo and hero image.
2. Adds 4 Lices, 3 tournaments (Longsword Open, Sidesword Open, Women's Longsword).
3. Imports 80 fighters from CSV; system suggests HEMA Ratings links.
4. Opens the AI setup assistant to draft tournament configuration, pool size assumptions, match-grid timing, and referee assignment suggestions; reviews each draft before applying.
5. Uses the natural-language query panel to check "Combien de combats restent dans chaque poule ?" or "Are we on schedule?" without writing reports manually.
6. Goes to Pool Populator: 4 pools per event, school separation on, skill balance on. Clicks generate. Reviews. Two clubs have 3 fighters each in the same pool — drags one out manually, cost recomputes. Saves.
7. Goes to Referees → Pool: adds 12 qualified users, sets ratings per role.
8. Clicks Auto-assign Referees. Engine returns: 32 cells assigned, 1 missing (Pool C arbitre_assesseur — no qualified candidate available; rejection_reason: no_qualified_users). Organizer manually invites another referee, then re-runs.
9. Locks assignments. Notifications go out automatically (assigned referees get a push).
10. Day before event: publishes the event site.

### Organizer on event day

1. Walks the venue with a laptop.
2. Watches live dashboard: which matches are running on which Lices, score deltas.
3. A scorekeeper voids an exchange in error → audit log captures it; super admin approves the void.
4. Workshop instructor doesn't show — organizer cancels the session; all enrollees get a push notification.
5. A room change happens — organizer sends a Warning broadcast to fighters and referees, with email fallback for unclaimed roster entries.
6. End of day: publishes final results. Statistics page goes live, mirroring the lyonamhe.fr layout.

### Super admin operations

1. Configures a shared super-admin BYOK key for platform-only AI tools, separate from organizer/event AI keys.
2. Launches a data-quality scan from `/admin/data-quality`.
3. Reviews duplicate global Person, referee-link, and club/school findings with deterministic evidence plus AI-ranked explanation.
4. Opens the relevant merge or club review page and resolves or dismisses each finding manually. V1 never auto-merges or auto-edits records.

---

## Key components

| Component                      | What it does                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **Public app**                 | Mobile experience for competitors, referees, workshop attendees, spectators, with each Event's logo and hero image.              |
| **Staff PWA**                  | Tablet-first offline-first per-exchange entry, plus the check-in desk, gear check and photo moderation.                          |
| **Admin app**                  | Desktop-first organizer toolset and super admin.                                                                                 |
| **Ruleset engine**             | Pluggable scoring rulesets (TF_v1 canonical). Pure functions, server-authoritative + client-side mirror for instant feedback.    |
| **Pool populator**             | Constraint-driven pool generation (school separation, skill balance).                                                            |
| **Referee assigner**           | Constraint-driven 3-role assignment with feasibility report.                                                                     |
| **Statistics engine**          | Fighter, Tournament and Event statistics computed when read, from the exchanges; mirrors lyonamhe.fr layout.                     |
| **Realtime layer**             | Supabase Realtime broadcasts row changes to subscribed clients.                                                                  |
| **Offline outbox**             | IndexedDB queue on the staff app, with idempotent server reconciliation.                                                         |
| **Notification scheduler**     | BullMQ-driven web push for matches, workshops, schedule changes and FightBook; runs in the worker process.                       |
| **Organizer AI assistant**     | Organization-BYOK draft-and-review assistant for tournament setup, pools, brackets, scheduling, and referee assignments.         |
| **Tournament query assistant** | Organization-BYOK natural-language read-only query surface for tournament stats, lices, pools, brackets, schedule, and referees. |
| **AI data-quality assistant**  | Super-admin review queue for duplicate people, referees, clubs, and identity gaps using separate platform BYOK.                  |
| **Organizer chatbot**          | Conversational, tool-using organizer assistant that streams progress over SSE.                                                   |
| **AI model registry**          | Per-org provider + model selection across Anthropic, OpenAI, Mistral and Google (Gemini) adapters.                               |
| **AI consumption dashboard**   | Per-org AI usage summary with budget caps, spend-cap enforcement, and feature flags.                                             |
| **Generated content**          | AI-drafted, publishable tournament recaps, organizer content, and fighter insights.                                              |
| **League engine**              | Multi-tournament league standings with per-league roles, recompute, and report export.                                           |
| **People Hub**                 | Cross-event directory: follow by global identity, group people with live match status.                                           |
| **FightBook**                  | Sparring-partner finder: requests, an Inbox, agreed spars, thank-yous, favourites, blocks, safety reports, floor tools.          |
| **Event photos**               | Photos sent by phone to an Event's public page, moderated, kept 30 days in their own storage bucket.                             |
| **Protest counter**            | A fighter's protests, recorded on the pad, shown on the TV and in the statistics; never part of the score.                       |
| **Display screens**            | TV and projector views of a bout, a piste or the whole Event.                                                                    |

---

## Data sources

- **Internal**: per-event data (organizer-created); per-exchange match data (scorekeeper-created); user profiles.
- **External (read-only)**: HEMA Ratings dataset, pulled daily, for fighter rating display and pool skill balancing.
- **External (write, organizer-mediated)**: HEMA Ratings export — organizers download a formatted file and submit it to HEMA Ratings curators manually.

---

## Design / UX

- **Design language**: the **Tournament Manual** — Fraunces display + Geist body (+ JetBrains Mono for codes). Red accent (`#b91c1c`) on warm paper, gold for placings, a blue accent reserved for the personal space. Red and blue also carry rule semantics as the HEMA fighter corners, tokenized separately so they are never decoration. The FoilMark (a fencing foil's cross-guard) is the only ornament. **[`/DESIGN.md`](DESIGN.md) is canonical**; token values live in `packages/ui/src/theme.css`.
- **Mobile-first**: every public app screen is built for one-handed phone use first. Desktop layouts are derived from mobile by widening, not redesigning.
- **Tablet-first staff app**: large, gloved-finger-friendly buttons. Color-coded (red fighter / blue fighter). High-contrast for outdoor lighting.
- **Desktop-first admin**: dense, table-driven, drag-drop for scheduling.
- **Per-event identity**: each event site carries the organizer's logo, hero image and description. Colours, fonts, layout and components are the same for every Event; per-Event colours were built and then removed.
- **Internationalization**: EN and FR both ship and are both mandatory — every `t()` key must resolve in each, gated by `packages/i18n/src/t-key-references.test.ts`. HEMA terminology had native review; referee role names stay in French.

---

## Known limitations / open points

- **Multi-scorekeeper conflict resolution**: skipped for v1. One scorekeeper per Lice.
- **Live video integration**: not in v1.
- **Native mobile apps**: web PWAs only. May follow later.
- **HEMA Ratings push API**: not available. Manual submission via export for v1.
- **Frozen results state**: post-publish edits to exchanges require super-admin approval to prevent ranking manipulation.
- **Federation with other event platforms**: import from hemaScorecard exports is a v2 nice-to-have.
- **Crowd judging / spectator scoring**: out of scope; would be entertainment-only and never authoritative.

---

## Reference points

- **Live beta**: `https://myfal.lyonamhe.fr/` — the Lyon AMHE Fosse aux Lions companion app. Validates the persona model and "My Schedule" UX.
- **Reference statistics page**: `https://lyonamhe.fr/resultat_fal2026.html` — the layout MyClash's statistics module reproduces.
- **Reference prior art**: hemaScorecard at `https://github.com/SeanFranklin/hemaScorecard` — what MyClash improves on (per-exchange capture, mobile-first UX, themed public app, offline scoring, workshops, refereeing engine).

---

_This document evolves with the product. Update it when feature scope or UX direction changes._
