# myclash.md — Functional & Design Reference

> Product-level understanding of MyClash. This document focuses on **what the app does and feels like**, not how it's built.
>
> For technical architecture, see `docs/ARCHITECTURE.md`.
> For repo orientation, see `README.md`.

---

## Overview

MyClash is a free, open-source platform that lets HEMA event organizers run their events end-to-end and publish results — while giving competitors, spectators, referees, and workshop attendees a single mobile-first experience for everything they need on event day.

It replaces the patchwork of tools currently used: hemaScorecard for brackets, spreadsheets for schedules, static HTML pages for results, paper for refereeing. MyClash unifies these into one platform with three coordinated surfaces (public PWA, scoring tablet PWA, organizer admin) and a shared backend that captures every exchange.

It is designed around three convictions:

1. **Real HEMA events happen in spaces with bad wifi.** Offline-first scoring is the quality bar.
2. **Per-exchange data is the only honest source of truth.** Aggregate scores derive; raw exchanges persist.
3. **Per-event theming makes platforms feel like local events.** A platform doesn't have to feel like a platform.

---

## Features (v1)

### For event organizers

- Create a themed event site (logo, colors, custom pages) at `app.myclash.fr/e/[slug]`.
- Define multiple events (weapon × category) with configurable rulesets.
- Configure Lices (pistes) — multi-Lice scheduling.
- Register fighters individually or via CSV import; suggest matches against global fighter database and HEMA Ratings.
- **Pool populator** with configurable constraints: school separation, skill balancing using HEMA Ratings, manual override.
- **Referee assignment**: manage referee qualifications (3 roles, per-role rating 1–5), auto-assign with constraint solver, see missing-role report, manually override.
- AI setup assistant creates reviewed drafts for tournament configuration, pool plans, brackets, exact match-grid scheduling, and referee assignments using the organizer's BYOK key.
- Generate single-elimination brackets from pool standings, including arbitrary-size fields with play-in matches for low seeds, then publish or unpublish pool/bracket visibility independently when ready.
- Record fighter forfeits from scoring/admin with ruleset-configurable behavior for injury, voluntary withdrawal, black cards, and conduct violations, including pool auto-forfeits and bracket walkovers/replacements.
- Schedule matches and workshops on a unified day grid.
- Manage workshops: instructors (optional fighter link), descriptions, sessions, capacity, waitlists.
- Send event-wide notifications to everyone, fighters, referees, fighters and referees, or selected people with Info, Warning, and Alert severity; pool/bracket publish flows can prefill an editable "ready" broadcast.
- Publish results, rich statistics, and export to CSV/JSON/PDF/HEMA Ratings format.

### For scorekeepers

- Tablet-first PWA, installable, **fully offline-capable**.
- Per-exchange entry: clean hits (1pt/2pt), afterblows, doubles, no-exchange — large gloved-finger-friendly buttons.
- Match clock with halt/resume.
- Undo last exchange within a window.
- Always shows explicit network/sync state.

### For competitors

- Persona-aware home screen: "my next match", "my pool", "where I need to be".
- Live results across all events.
- Workshop catalog with one-tap enrollment.
- **My Schedule**: unified view of fights, refereeing, workshops with conflict markers.
- Push notifications for upcoming matches, workshops, schedule changes.
- Claimed fighters can change their login/contact email after confirming a link sent to the new address.

### For referees

- Confirm/decline assignments.
- On-piste tools: halt/resume, issue warnings, request scorekeeper attention.
- Schedule overlaid in My Schedule with role labels.

### For workshop attendees

- Browse catalog by day/category/level/language/instructor.
- Enroll; see waitlist position when full; auto-promote when a spot opens.
- Notifications for cancellations and promotions.

### For spectators / accompanists

- **Search any participant** in the event — fighters, referees, workshop leads.
- **Follow people** to build a personal watchlist (a coach watches their three students; a parent follows their kid).
- **Watchlist view** shows next-match / live-now / just-finished state for everyone you follow, all in one screen.
- Live Lice view: current and upcoming matches.
- **Push notifications** when someone you follow is about to fight (claimed accounts only — verifies email ownership).
- Live exchange feed during matches.
- Event editorial pages, history, club directory.
- Following works for anonymous users too (saved on their device), but push notifications and cross-device sync require a quick magic-link claim.

### For platform admin (super admin)

- Approve organizer accounts.
- Moderate global fighter profiles (merge duplicates).
- Approve community-submitted rulesets.
- Audit log review.

---

## User journeys

### Competitor on event day

1. Opens `myclash.fr/t/fal2026` on phone.
2. Logs in (or already logged in from prior visit).
3. Onboarding (first time only): selects "Competitor" + maybe "Workshop attendee".
4. Lands on Competitor home: "Your next match — Pool A on Lice 1 at 10:30. Check in at registration desk."
5. Throughout the day, gets push notifications 10 min before matches.
6. Between matches: opens My Schedule to see what's next, including their afternoon workshop.
7. If their contact email changes, opens profile email settings, enters the new address, and confirms the link sent there.
8. After the organizer publishes pools or brackets, views their pool standings live; sees their final ranking when published.

### Scorekeeper at the piste

1. Borrowed tablet at Lice 2; PWA pre-installed.
2. Logs in once at start of day.
3. UI shows: "Lice 2 — Pool C, Match 1: Alice (red) vs Bob (blue), Longsword".
4. Taps "Start match" → clock starts.
5. Alice strikes Bob's head (2pt clean). Tap red → 2pt → clean. Confirmed.
6. They strike simultaneously (double). Tap "double".
7. Match ends. Tap "End match" → score finalized; queue advances.
8. **At any point, wifi can drop**: queue grows in IndexedDB outbox. UI shows "offline · 7 pending". Reconnect → silent sync.

### Organizer pre-event

1. Creates event; configures theme to match their club's identity.
2. Adds 4 Lices, 3 events (Longsword Open, Sidesword Open, Longsword Women's).
3. Imports 80 fighters from CSV; system suggests HEMA Ratings links.
4. Opens the AI setup assistant to draft tournament configuration, pool size assumptions, match-grid timing, and referee assignment suggestions; reviews each draft before applying.
5. Goes to Pool Populator: 4 pools per event, school separation on, skill balance on. Clicks generate. Reviews. Two clubs have 3 fighters each in the same pool — drags one out manually, cost recomputes. Saves.
6. Goes to Referees → Pool: adds 12 qualified users, sets ratings per role.
7. Clicks Auto-assign Referees. Engine returns: 32 cells assigned, 1 missing (Pool C arbitre_assesseur — no qualified candidate available; rejection_reason: no_qualified_users). Organizer manually invites another referee, then re-runs.
8. Locks assignments. Notifications go out automatically (assigned referees get a push).
9. Day before event: publishes the event site.

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

| Component                     | What it does                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Public PWA**                | Per-event themed mobile experience for competitors, referees, workshop attendees, spectators.                                 |
| **Scoring PWA**               | Tablet-first offline-first per-exchange entry.                                                                                |
| **Admin SPA**                 | Desktop-first organizer toolset and super admin.                                                                              |
| **Ruleset engine**            | Pluggable scoring rulesets (TF_v1 canonical). Pure functions, server-authoritative + client-side mirror for instant feedback. |
| **Pool populator**            | Constraint-driven pool generation (school separation, skill balance).                                                         |
| **Referee assigner**          | Constraint-driven 3-role assignment with feasibility report.                                                                  |
| **Statistics engine**         | Materialized views of fighter/tournament/event stats; mirrors lyonamhe.fr layout.                                             |
| **Realtime layer**            | Supabase Realtime broadcasts row changes to subscribed clients.                                                               |
| **Offline outbox**            | IndexedDB queue on the scoring app, with idempotent server reconciliation.                                                    |
| **Notification scheduler**    | BullMQ-driven web push for matches, workshops, schedule changes.                                                              |
| **Organizer AI assistant**    | Organization-BYOK draft-and-review assistant for tournament setup, pools, brackets, scheduling, and referee assignments.      |
| **AI data-quality assistant** | Super-admin review queue for duplicate people, referees, clubs, and identity gaps using separate platform BYOK.               |

---

## Data sources

- **Internal**: per-event data (organizer-created); per-exchange match data (scorekeeper-created); user profiles.
- **External (read-only)**: HEMA Ratings dataset, pulled daily, for fighter rating display and pool skill balancing.
- **External (write, organizer-mediated)**: HEMA Ratings export — organizers download a formatted file and submit it to HEMA Ratings curators manually.

---

## Design / UX

- **Design language**: Cinzel display + Inter body. Red and blue (HEMA fighter colors), gold for accents, deep neutrals for backgrounds. Shield and crossed-sword motifs used sparingly. The prototype HTML in `docs/prototype/` is canonical.
- **Mobile-first**: every public app screen is built for one-handed phone use first. Desktop layouts are derived from mobile by widening, not redesigning.
- **Tablet-first scoring app**: large, gloved-finger-friendly buttons. Color-coded (red fighter / blue fighter). High-contrast for outdoor lighting.
- **Desktop-first admin**: dense, table-driven, drag-drop for scheduling.
- **Per-event theming**: each event site adopts the organizer's logo, colors, and editorial content. Layout and components stay consistent — only the skin changes.
- **Internationalization**: English at launch, French in v1.1. HEMA terminology requires native review (referee role names stay in French).

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
