---
title: How MyClash works
description: 'The words MyClash uses, its three apps, who sees what, and how a score is counted.'
order: 11
section: concepts
---

**What you'll learn:** the words MyClash uses, how to read a bout's code, its three apps, who sees
what, and where a score comes from.

## The words

- **Event**: the gathering, with its dates, its venue and its pistes. A club night is an event; so
  is a three-day open.
- **Tournament**: one competition inside the event: one weapon, one category, one ruleset. An
  event can hold several.
- **Workshop**: a class inside the event, with its sessions and its sign-ups.
- **Phase**: a stage of a tournament with one format: pools, a bracket (single or double
  elimination) or Swiss rounds.
- **Pool**: a group in which every fighter meets every other fighter.
- **Match** (a bout on screen): two fighters, one red and one blue.
- **Exchange**: one action the scorekeeper enters: a clean hit, an afterblow, a double hit, or no
  exchange. Everything else is calculated from the exchanges.
- **Piste** (a "lice" in the app): where a bout is fought.
- **Venue**: a place you saved, with its pistes, that new events can reuse.

A fighter has one **profile** on MyClash that follows them from event to event. At your event they
are a **participant**; in a tournament they hold a **registration**.

## Bout codes

Every bout has a short code that names it the same way everywhere: on the tablet, the schedule,
the live boards, the notifications and the exports. Read it in three parts: the weapon, the
stage, then the bout.

| Code          | Reads as                                               |
| ------------- | ------------------------------------------------------ |
| `LSW-P4-M01`  | Longsword, pool 4, bout 1 of that pool                 |
| `SDW-S3-M05`  | Sidesword, Swiss round 3, bout 5 of that round         |
| `LSW-B-QF-M3` | Longsword, bracket, quarter-final, bout 3 of the round |
| `LSW-B-F-M1`  | Longsword, bracket, the final                          |
| `LSW-B-F-M2`  | Longsword, bracket, the bronze match (third place)     |

- **The weapon:** LSW longsword, SDW sidesword, RAP rapier, SBR sabre, SB sword and buckler. Any
  other weapon takes the first three letters of its name: a Dussack tournament reads DUS.
- **The stage:** P and the pool's number, S and the Swiss round, or B for every bracket bout,
  followed by its round:
  - R64, R32, R16 (the rounds of 64, 32 and 16), QF the quarter-finals, SF the semi-finals, F the
    final, PI the play-in;
  - a double elimination bracket names its side too: WBQF, WBSF, WBF for the winners bracket's
    quarter-finals, semi-finals and final, LB1, LB2… for the losers bracket's rounds, GF the grand
    final and GFR its reset;
  - B with no round is a bout added by hand to a bracket.
- **The bout:** M and its number. In a pool or a Swiss round, it is the order the bouts are
  fought in, written with as many digits as the pool needs, so M02 comes before M10. In a
  bracket, it is the bout's place in its round, counted from the top. In the last round, M1 is
  the final and M2 the bronze match.

## Three apps

| App                     | Address          | Who uses it                                                      |
| ----------------------- | ---------------- | ---------------------------------------------------------------- |
| The organiser workspace | admin.myclash.fr | You and your club's members                                      |
| The tablets             | staff.myclash.fr | Scorekeepers, the welcome desk, the gear check, photo moderators |
| The public app          | app.myclash.fr   | Fighters, referees and spectators                                |

In the public app, people see the event pages: the live bouts, the schedule, the pools, the
brackets and the results. A fighter with an account also has a personal space: their bouts, the
workshops they joined, the people and clubs they follow.

## Who sees what

- A **draft** event and a **test** event are hidden from the public. Members of your club still see
  them.
- A tournament is public only when it is **published**, running or completed, and its event is
  public too.
- Your club's members see everything, drafts included, according to their role (see the
  "Staff access" page of this section).

## Where a score comes from

The scorekeeper never types a score. They enter **exchanges**, and MyClash calculates the score
from them with the tournament's **ruleset**. The tablet shows the score straight away; the server
calculates it again from the same exchanges, and the server's result is the one that counts.

A correction never deletes anything: it cancels an exchange, and the score is calculated again.

_Without wifi_, the tablet keeps every exchange in a queue and sends it when the network comes
back. Each exchange carries its own identity, so an exchange sent twice still counts once. The
"Pad reference" page, in the scoring pad section, lists what works offline and what does not.
