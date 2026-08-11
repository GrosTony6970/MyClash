# Hierarchy & terminology (canonical)

> This document is **authoritative** for the MyClash data hierarchy and naming. If anything in `ARCHITECTURE.md`, `BUILD_ORDER.md`, `myclash.md`, or any code conflicts with this, this wins.

Three separate structures live here, and confusing them is the mistake this file exists to prevent:
the **competition hierarchy** (who fights whom, in what), the **physical space** (where it happens),
and **identity** (who a person is, across events and within one).

## The competition hierarchy

```
Organization
  └── Event                    ← the gathering ("FAL 2026", "Swordfish 2027")
        ├── Tournament         ← a competition within an event ("Longsword Open")
        │     └── Phase        ← a stage of that tournament, with a format
        │           │            (pool | single_elim | double_elim | swiss)
        │           ├── Pool           ← round-robin group   (pool phases)
        │           ├── Bracket slot   ← a node in the tree  (elimination phases)
        │           ├── Swiss round    ← one pairing round   (swiss phases)
        │           └── Match          ← always belongs to the Phase directly
        │                 └── Exchange ← the atomic scoring unit
        └── Workshop           ← a teaching session
              └── WorkshopSession (recurring slots)
```

**Phase is a real tier, not a synonym for Pool.** `matches.phase_id` is `NOT NULL` — every match
belongs to a phase. `pool_id`, `bracket_slot_id` and `swiss_round_id` are all _nullable_, and which
one is set depends on the phase's `type`. A tournament typically runs a pool phase and then an
elimination phase, but any combination is legal, and **Swiss is a first-class format** alongside the
other three.

**Bracket** is the slot tree of an elimination Phase — a useful word, not a tier. There is no
`brackets` table; there is `bracket_slots`, hanging off `phase_id`.

## The physical space

Where a match happens is a separate containment hierarchy that ends at Match:

```
Organization
  └── Venue                ← a place the org runs events at
        ├── Venue Area     ← optional sub-room within the venue
        └── Venue Lice     ← the venue's reusable catalogue of lice names (setup data)

Event
  └── Lice                 ← the fighting area, scoped to the event
        └── Match          ← matches.lice_id
```

**A Lice is where matches happen.** It belongs to an Event (`lices.event_id` is required) and points
at its physical home through nullable `venue_id` and `area_id` — nullable because an operator may
create a lice before linking it to a venue.

**Venue Lice is not a Lice.** `venue_lices` is a per-venue list of names that event creation copies
from. It is setup data. Nothing schedules a match onto one.

## Identity

Three distinct things, and a column named `user_id` may hold any of them if you do not check:

```
Global Person    ← one row per human, across all events        (global_persons)
      ▲
      │ persons.global_person_id (nullable — a local person may not be linked yet)
      │
Person           ← that human at ONE event                     (persons.event_id required)
      ▲
      │ registrations.person_id
      │
Registration     ← that person entered in ONE tournament       (registrations.tournament_id)
      ▲
      │ matches.red_registration_id / blue_registration_id
      │
Match            ← the two sides of a fight are Registrations, not Persons
```

A person registers once per **event**, then holds a registration per **tournament** inside it.

## Plain-language definitions

| Term              | What it is                                                                                        | Example                             |
| ----------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **Organization**  | The entity (club, federation, individual) that runs events.                                       | Lyon AMHE; HEMA Bohemia             |
| **Event**         | The multi-day gathering with a name, date(s), venue, and a roster of participants.                | "FAL 2026", "Swordfish 2027"        |
| **Tournament**    | A specific competitive format inside an event: one weapon, one category, one ruleset.             | "FAL 2026 Longsword Open"           |
| **Phase**         | A stage of a tournament with one format. `pool`, `single_elim`, `double_elim` or `swiss`.         | "Pools", then "Top 16"              |
| **Pool**          | A round-robin group of fighters within a pool phase.                                              | "Pool A: 6 fighters"                |
| **Bracket**       | The slot tree of an elimination phase. Not a table — `bracket_slots` rows.                        | Top 16 single-elim                  |
| **Swiss round**   | One pairing round of a swiss phase.                                                               | "Round 3 of 5"                      |
| **Match**         | A single fight between two registrations. Always belongs to a phase.                              | "Pool A · Match 7"                  |
| **Exchange**      | The atomic scoring unit.                                                                          | "Clean hit, fighter A, head"        |
| **Workshop**      | A teaching session inside an event. Has an instructor, a topic, capacity, and recurring sessions. | "Beginner Sword & Buckler workshop" |
| **Venue**         | A place an organization runs events at. May have sub-areas.                                       | "Gymnase Jean Moulin"               |
| **Lice**          | The fighting area a match is held on. Scoped to an event; optionally placed in a venue and area.  | "Lice 3"                            |
| **Global Person** | One human, across every event. The cross-event identity.                                          | Jean Dupont, everywhere             |
| **Person**        | That human at **one** event. Scoped by `event_id`.                                                | Jean Dupont at FAL 2026             |
| **Registration**  | A person entered in **one** tournament.                                                           | Jean Dupont in the Longsword Open   |

## Roles

| Role                    | Scope                                                       |
| ----------------------- | ----------------------------------------------------------- |
| Event organizer         | Owns the event                                              |
| Tournament admin        | Runs one or more tournaments inside an event                |
| Workshop lead           | Teaches a workshop inside an event                          |
| Scorekeeper             | Records exchanges in matches inside a tournament            |
| Referee                 | Officiates matches inside a tournament                      |
| Workshop attendee       | Enrolled in a workshop session                              |
| **Fighter**             | Competes in a tournament — holds a Registration. See below. |
| Spectator / accompanist | Anyone (anonymous, guest, claimed)                          |

**Fighter is the canonical word for the competing role.** "Competitor" is its formal synonym and
means exactly the same thing — use _Fighter_ in code, UI and docs. There is deliberately **no**
distinction between "registered" and "currently fighting": nothing in the schema keys off it, so
splitting the two words would invent a difference the data does not carry.

**Fighter is a role, never an entity.** It is not a table and not a synonym for Global Person. The
`global_persons.is_fighter` flag is a **directory-discoverability** flag — "this person shows up in
fighter listings" — not a statement about any tournament.

## Code naming (locked-in)

- DB tables: `events`, `tournaments`, `phases`, `pools`, `bracket_slots`, `swiss_rounds`, `matches`,
  `exchanges`, `registrations`, `persons`, `global_persons`, `workshops`, `workshop_sessions`,
  `venues`, `venue_areas`, `venue_lices`, `lices`.
- API routes: `/api/v1/events/:id`, `/api/v1/events/:id/tournaments`, `/api/v1/tournaments/:id`,
  `/api/v1/events/:id/workshops`, `/api/v1/events/:id/persons`.
- App URLs:
  - `app.myclash.fr/e/<event-slug>` — public event page (the gathering's "home")
  - `app.myclash.fr/e/<event-slug>/t/<tournament-slug>` — a specific tournament inside it
  - `app.myclash.fr/e/<event-slug>/w/<workshop-slug>` — a workshop inside it
  - `app.myclash.fr/fighters/<slug>` — a global person's public profile
  - `admin.myclash.fr/org/<org-slug>/events/<event-slug>` — organizer admin

**Historical naming that does not match this document.** Migration `0023` renamed the `fighters`
table to `global_persons`, but several identifiers kept the old word and still mean _global person_:
the `fighter_clubs`, `fighter_weapons`, `fighter_manual_medals`, `fighter_ai_keys` and
`fighter_ai_usage_log` tables, and the `/api/v1/fighters/*` routes. Read them as global-person
objects. The public `/fighters/<slug>` URL keeps the word on purpose — it is quoted in the published
privacy policy and printed on event passes.

For French terminology, see [`notes/glossary.md`](notes/glossary.md).

## Why this hierarchy

A real HEMA gathering looks like this:

> **FAL 2026** (event)
> ├── Longsword Open (tournament — TF_v1 ruleset, 32 fighters, 1 day)
> │ ├── Pools (phase — 6 pools of 5)
> │ └── Top 16 (phase — single elimination)
> ├── Sidesword Open (tournament — different ruleset, 16 fighters, half day)
> ├── Women's Longsword (tournament — 12 fighters, half day)
> ├── Workshop: Italian rapier basics (workshop — 2 sessions of 90 min)
> └── Workshop: Tournament refereeing (workshop — 1 session of 120 min)

Trying to model this with "Tournament = the gathering" forces you to either flatten weapon categories into a single tournament (loses ruleset specificity) or invent a new term for "gathering" later. Better to lock it in correctly now.

Phase exists for the same reason one level down: a tournament that runs pools and then a bracket is
two stages with different formats, different pairing rules and different completion conditions.
Without the tier, "pool" ends up meaning both "a round-robin group" and "the round-robin stage".

## When in doubt

If the agent (or you) ever confuse the two terms in code or docs, fall back to: **the user-facing thing the public visits is an Event; what they register for and compete in is a Tournament**. The URL hierarchy mirrors this: `/e/<event>/t/<tournament>`.

For identity, fall back to the scope: **Global Person is forever, Person is one event, Registration
is one tournament.** If you are holding a UUID and cannot say which of the three it is, do not guess
— check the column it came from.
