# Hierarchy & terminology (canonical)

> This document is **authoritative** for the MyClash data hierarchy and naming. If anything in `ARCHITECTURE.md`, `myclash.md`, or any code conflicts with this, this wins.

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
        └── Workshop           ← a taught class
              └── Workshop session ← one dated sitting, with its own seats,
                                     waiting list and roster
```

**A Match holds more than Exchanges.** A card (`match_penalties`) and a Protest (`match_protests`)
are entries of the Match beside its Exchanges, in one shared order. A Protest never reaches the
score.

**A League is not in this tree.** A League spans Events: it collects the results of Tournaments held
at different Events, by different Organizations, into the standings of one season. It links to
Tournaments and owns none.

**A Spar is not in this tree.** A Spar is one friendly, unscored meeting between two fighters,
arranged through FightBook. It has no Exchanges, no score, no ruleset and no referee, so it is not a
Match. It keys on Global Persons, not on Registrations. It may name an Event day, or a free date and
place outside any Event. See
[the FightBook design](superpowers/archive/specs/2026-11-10-fightbook-design.md).

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
Match            ← the two sides of a fight are Registrations or Teams, never Persons
```

A person registers once per **event**, then holds a registration per **tournament** inside it.

## Plain-language definitions

| Term                 | What it is                                                                                                                                                | Example                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **Organization**     | The entity (club, federation, individual) that runs events.                                                                                               | Lyon AMHE; HEMA Bohemia             |
| **Event**            | The multi-day gathering with a name, date(s), venue, and a roster of participants.                                                                        | "FAL 2026", "Swordfish 2027"        |
| **Event day**        | One calendar day of an event, measured on the **event's** timezone — never the browser's, never UTC. Derived from a scheduled start; not a stored column. | "Sat 22/05" of a 22–23/05 event     |
| **Tournament**       | A specific competitive format inside an event: one weapon, one category, one ruleset.                                                                     | "FAL 2026 Longsword Open"           |
| **Phase**            | A stage of a tournament with one format. `pool`, `single_elim`, `double_elim` or `swiss`.                                                                 | "Pools", then "Top 16"              |
| **Pool**             | A round-robin group of fighters within a pool phase.                                                                                                      | "Pool A: 6 fighters"                |
| **Bracket**          | The slot tree of an elimination phase. Not a table — `bracket_slots` rows.                                                                                | Top 16 single-elim                  |
| **Swiss round**      | One pairing round of a swiss phase.                                                                                                                       | "Round 3 of 5"                      |
| **Match**            | A single fight between two sides. Always belongs to a phase.                                                                                              | "Pool A · Match 7"                  |
| **Exchange**         | The atomic scoring unit.                                                                                                                                  | "Clean hit, fighter A, head"        |
| **Card**             | A penalty given to a fighter in a Match, from the penalty list of the ruleset. An entry of the Match, in `match_penalties`.                               | "Yellow card, blue, round 1"        |
| **Protest**          | One record that a fighter disputed the referee's call. An entry of the Match, in `match_protests`. Counted per fighter; never part of the score.          | "Red protests, 1 of 2"              |
| **Round**            | One of the N rounds of a best-of-N Match. Not a Swiss round.                                                                                              | "Round 2 of 3"                      |
| **Forfeit**          | A Match a fighter gives up or is removed from. The penalty ruleset says what it does to the score and to the fighter.                                     | "Injury, 0-X loss"                  |
| **League**           | Standings across Events: the results of linked Tournaments, counted over one season. Outside the competition tree.                                        | "Classement 2026"                   |
| **Spar**             | One friendly, unscored meeting between two fighters, with one or more weapons. Not a Match: no Exchanges. Outside the competition tree.                   | "Longsword spar, Sat after Pools"   |
| **Workshop**         | A taught class inside an event. Has one or more instructors, a topic, and one or more Workshop sessions.                                                  | "Beginner Sword & Buckler workshop" |
| **Workshop session** | One dated sitting of a Workshop, with its own seats, waiting list and roster. It can be cancelled on its own.                                             | "Sat 10:00, 20 seats"               |
| **Event photo**      | A photo sent to an Event by someone who was there, shown on the Event's public page and deleted 30 days after the Event.                                  | "Podium, Longsword Open"            |
| **Venue**            | A place an organization runs events at. May have sub-areas.                                                                                               | "Gymnase Jean Moulin"               |
| **Lice**             | The fighting area a match is held on. Scoped to an event; optionally placed in a venue and area.                                                          | "Lice 3"                            |
| **Global Person**    | One human, across every event. The cross-event identity.                                                                                                  | Jean Dupont, everywhere             |
| **Person**           | That human at **one** event. Scoped by `event_id`.                                                                                                        | Jean Dupont at FAL 2026             |
| **Registration**     | A person entered in **one** tournament.                                                                                                                   | Jean Dupont in the Longsword Open   |
| **Team**             | A named group entered in one team Tournament. Has a size and numbered slots.                                                                              | "Lyon A", 3 slots                   |
| **Slot**             | One numbered place in a Team. Holds a Person of the Event, or nobody.                                                                                     | "Fighter 2" of Lyon A               |
| **Side**             | One of the two parties of a Match: a Registration or a Team.                                                                                              | Red side, blue side                 |
| **Line-up**          | Which slot of each team is on the piste at a given moment.                                                                                                | Slot 1 of red, slot 3 of blue       |
| **Captain**          | The one named slot of a Team marked as its captain. A mark, not a role with powers.                                                                       | Slot 1 of Lyon A                    |
| **Reserve**          | A named Person attached to a Team with no slot number, who can take a number during a Match.                                                              | A 4th Fighter of a team of 3        |
| **Leg**              | A stretch of a relay Match between two line-up changes.                                                                                                   | "Leg 2: 0:30 to 1:00"               |

**The UI says "bout" and "piste".** On screen, in English, a Match is a "bout" and a Lice is a
"piste". They are the same two things. Code, tables and docs say Match and Lice.

### FightBook words

FightBook is the part of the public app where fighters find a sparring partner. Its words:

| Term                 | What it is                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spar request**     | One fighter asks another for a Spar. The other answers "Yes" or "Not this time". A "Yes" makes it an agreed Spar.                              |
| **Open call**        | A post at a running Event ("Longsword at 15:00"). Others at the Event answer "I'm in", and the poster picks one.                               |
| **Free to spar now** | A mark a fighter sets at a running Event, for one hour.                                                                                        |
| **Favourite**        | A private mark one fighter keeps on another FightBook user.                                                                                    |
| **Block**            | One fighter refuses every request from another. To the other it reads like any "no".                                                           |
| **Thank-you**        | Stars one fighter sends to the partner after a Spar they both had, signed or anonymous.                                                        |
| **Safety flag**      | A report of a safety problem about the partner of a Spar. It reaches the admins of the Event's club, or the super admins for a free-date Spar. |
| **Daily limit**      | "At most N spars a day", set by a fighter. A request for a day that is already full ends "Not this time" at once.                              |

## Roles

| Role                    | Scope                                                                            |
| ----------------------- | -------------------------------------------------------------------------------- |
| Event organizer         | Owns the event                                                                   |
| Instructor              | Teaches a workshop inside an event                                               |
| Scorekeeper             | Records exchanges in matches inside a tournament                                 |
| Referee                 | Officiates matches inside a tournament                                           |
| Workshop attendee       | Enrolled in a workshop session                                                   |
| **Fighter**             | Competes in a tournament — holds a Registration, or a slot in a Team. See below. |
| Spectator / accompanist | Anyone (anonymous, guest, claimed)                                               |

**Fighter is the canonical word for the competing role.** "Competitor" is its formal synonym and
means exactly the same thing — use _Fighter_ in code, UI and docs. There is deliberately **no**
distinction between "registered" and "currently fighting": nothing in the schema keys off it, so
splitting the two words would invent a difference the data does not carry.

**Fighter is a role, never an entity.** It is not a table and not a synonym for Global Person. The
`global_persons.is_fighter` flag is a **directory-discoverability** flag — "this person shows up in
fighter listings" — not a statement about any tournament.

**Instructor is the canonical word for the teaching role.** Say _Instructor_, not "Workshop lead", in
code, UI and docs.

**The roles above are what people do. The stored roles are three separate lists**, and a role name
alone does not say which list it is from:

- **Organization roles** (`organization_members.role`): `owner`, `admin`, `editor`, `scorekeeper`,
  `referee`, `workshop_lead` (shown as Instructor), `read_only`. There is no "Tournament admin": a
  role is held in a club, not in one Tournament.
- **Event staff jobs** (`event_staff_accounts.role`): `scoring`, `checkin`, `gear`, `photos`. These
  are the PIN logins of the staff app, one job each, for one Event.
- **Platform roles** (`platform_roles.role`): `super_admin`, `platform_admin`, `platform_viewer`.
  Authority over the platform itself, outside any club. A user holds at most one.

A League has its own two role tables (`league_organization_roles`, `league_user_roles`).

## Referee assignment

A **commitment** is anything that puts a person somewhere at a set time during an Event: fighting a
Match, refereeing a Pool or Match, teaching a Workshop, or attending one.

Whether a person may referee a Pool or Match is answered at one of three levels:

- **Impossible** — the assignment would put the person in two places at once, or outside their
  declared availability. No setting and no override.
- **Discouraged** — a soft rule applies, for example refereeing one's own Pool at another time. The
  organiser may go ahead after confirming. Each soft rule has one on/off switch per Event.
- **Fine** — no rule applies.

**"Locked" is not a level.** It is the referee board's freeze. See
[ADR-016](decisions/ADR-016-referee-rules-one-checker.md).

## Code naming (locked-in)

- DB tables: `events`, `tournaments`, `phases`, `pools`, `bracket_slots`, `swiss_rounds`, `matches`,
  `exchanges`, `match_penalties`, `match_protests`, `registrations`, `persons`, `global_persons`,
  `workshops`, `workshop_sessions`, `workshop_instructors`, `venues`, `venue_areas`, `venue_lices`,
  `lices`, `leagues`, `event_photos`, `spar_requests`, `teams`, `team_slots`.
- API routes: `/api/v1/events/:id`, `/api/v1/events/:id/tournaments`, `/api/v1/tournaments/:id`,
  `/api/v1/events/:id/workshops`, `/api/v1/events/:id/persons`.
- App URLs:
  - `app.myclash.fr/e/<event-slug>` — public event page (the gathering's "home")
  - `app.myclash.fr/e/<event-slug>/t/<tournament-slug>` — a specific tournament inside it
  - `app.myclash.fr/e/<event-slug>/w/<workshop-slug>` — a workshop inside it
  - `app.myclash.fr/fighters/<slug>` — a global person's public profile
  - `admin.myclash.fr/org/<org-slug>/events/<event-id>` — organizer admin (the Event's id, not its
    slug)

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
