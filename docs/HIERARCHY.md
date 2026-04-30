# Hierarchy & terminology (canonical)

> This document is **authoritative** for the MyClash data hierarchy and naming. If anything in `ARCHITECTURE.md`, `BUILD_ORDER.md`, `myclash.md`, or any code conflicts with this, this wins.

## The hierarchy

```
Organization
  └── Event              ← the gathering ("FAL 2026", "Swordfish 2027")
        ├── Tournament   ← a competition within an event ("Longsword Open")
        │     ├── Pool / Round-robin phase
        │     │     └── Match
        │     │           └── Exchange
        │     └── Elimination bracket
        │           └── Match
        │                 └── Exchange
        └── Workshop     ← a teaching session
              └── WorkshopSession (recurring slots)
```

## Plain-language definitions

| Term             | What it is                                                                                         | Example                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Organization** | The entity (club, federation, individual) that runs events.                                        | Lyon AMHE; HEMA Bohemia                                   |
| **Event**        | The multi-day gathering with a name, date(s), venue, and a roster of participants.                 | "FAL 2026", "Swordfish 2027"                              |
| **Tournament**   | A specific competitive format inside an event: one weapon, one category, one ruleset, one bracket. | "FAL 2026 Longsword Open"; "Swordfish 2027 Women's Sabre" |
| **Workshop**     | A teaching session inside an event. Has an instructor, a topic, capacity, and recurring sessions.  | "Beginner Sword & Buckler workshop"                       |
| **Pool**         | A round-robin group of fighters within a tournament.                                               | "Pool A: 6 fighters"                                      |
| **Bracket**      | The single/double-elimination tree following pools.                                                | Top 16 single-elim                                        |
| **Match**        | A single fight between two fighters within a tournament.                                           | "Pool A · Match 7"                                        |
| **Exchange**     | The atomic scoring unit.                                                                           | "Clean hit, fighter A, head"                              |

## Roles map to the hierarchy

| Role                    | Scope                                                                      |
| ----------------------- | -------------------------------------------------------------------------- |
| Event organizer         | Owns the event                                                             |
| Tournament admin        | Runs one or more tournaments inside an event                               |
| Workshop lead           | Teaches a workshop inside an event                                         |
| Scorekeeper             | Records exchanges in matches inside a tournament                           |
| Referee                 | Officiates matches inside a tournament                                     |
| Workshop attendee       | Enrolled in a workshop session                                             |
| Competitor              | Registered to a tournament (not an event — registration is per tournament) |
| Spectator / accompanist | Anyone (anonymous, guest, claimed)                                         |

## Code naming (locked-in)

- DB tables: `events`, `tournaments`, `workshops`, `workshop_sessions`, `pools`, `matches`, `exchanges`, `registrations`.
- API routes: `/api/v1/events/:id`, `/api/v1/events/:id/tournaments`, `/api/v1/tournaments/:id`, `/api/v1/events/:id/workshops`, `/api/v1/events/:id/persons`.
- App URLs:
  - `app.myclash.fr/e/<event-slug>` — public event page (the gathering's "home")
  - `app.myclash.fr/e/<event-slug>/t/<tournament-slug>` — a specific tournament inside it
  - `app.myclash.fr/e/<event-slug>/w/<workshop-slug>` — a workshop inside it
  - `admin.myclash.fr/org/<org-slug>/events/<event-slug>` — organizer admin
- Person scoping: persons are scoped to **events**, not tournaments. A person registers once per event, then has registrations across multiple tournaments inside that event.

## French translations (working)

| EN           | FR                               |
| ------------ | -------------------------------- |
| Organization | Organisation / Club organisateur |
| Event        | Événement                        |
| Tournament   | Tournoi                          |
| Workshop     | Atelier / Stage                  |
| Pool         | Poule                            |
| Bracket      | Tableau / Tableau d'élimination  |
| Match        | Assaut                           |
| Exchange     | Échange                          |

## Why this hierarchy

A real HEMA gathering looks like this:

> **FAL 2026** (event)
> ├── Longsword Open (tournament — TF_v1 ruleset, 32 fighters, 1 day)
> ├── Sidesword Open (tournament — different ruleset, 16 fighters, half day)
> ├── Women's Longsword (tournament — 12 fighters, half day)
> ├── Workshop: Italian rapier basics (workshop — 2 sessions of 90 min)
> └── Workshop: Tournament refereeing (workshop — 1 session of 120 min)

Trying to model this with "Tournament = the gathering" forces you to either flatten weapon categories into a single tournament (loses ruleset specificity) or invent a new term for "gathering" later. Better to lock it in correctly now.

## When in doubt

If the agent (or you) ever confuse the two terms in code or docs, fall back to: **the user-facing thing the public visits is an Event; what they register for and compete in is a Tournament**. The URL hierarchy mirrors this: `/e/<event>/t/<tournament>`.
